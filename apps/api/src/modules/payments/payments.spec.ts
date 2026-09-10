import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ChargilyProvider, constantTimeEquals, type HttpClient } from './chargily.provider.js';
import { CodProvider } from './cod.provider.js';
import { PaymentConfigurationError, WebhookVerificationError, type PaymentIntent } from './payment-provider.js';

/**
 * Payment adapters, against a stubbed HTTP client.
 *
 * An integration only ever exercised by making a real payment is one nobody exercises.
 * These cover the two things that actually break: the amount unit, and the webhook
 * signature check.
 */

const SECRET = 'chargily-webhook-secret';
const API_KEY = 'chargily-api-key';

function intent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    orderId: 'order-1',
    orderNumber: 'JK-260910-0042',
    amountMinor: 490_000n,
    currency: 'DZD',
    customerName: 'Yacine Benali',
    customerPhone: '+213551234567',
    customerEmail: null,
    returnUrl: 'https://jecks.dz/fr/checkout/confirmation',
    webhookUrl: 'https://api.jecks.dz/api/v1/webhooks/payments/chargily',
    description: 'Commande JK-260910-0042',
    ...overrides,
  };
}

function settings(values: Record<string, unknown> = {}) {
  return {
    get: async <T,>(key: string, fallback: T) => (key in values ? (values[key] as T) : fallback),
  } as never;
}

function secrets(values: Record<string, string | null> = {}) {
  return { secret: async (key: string) => values[key] ?? null } as never;
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('CodProvider', () => {
  const provider = new CodProvider();

  it('is always configured: the shop already has drivers', async () => {
    expect(await provider.isConfigured()).toBe(true);
  });

  it('needs no redirect and uses the order number as its reference', async () => {
    const session = await provider.createSession(intent());
    expect(session).toEqual({
      provider: 'cod',
      checkoutUrl: null,
      reference: 'JK-260910-0042',
      status: 'pending',
    });
  });

  it('refuses a webhook rather than pretending to understand one', async () => {
    await expect(provider.parseWebhook()).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe('ChargilyProvider — configuration', () => {
  it('is unconfigured when the shop has not switched it on', async () => {
    const provider = new ChargilyProvider(
      settings({ 'payments.chargily_enabled': false }),
      secrets({ 'payments.chargily_api_key': API_KEY }),
    );
    expect(await provider.isConfigured()).toBe(false);
  });

  it('is unconfigured when it is switched on but has no key', async () => {
    const provider = new ChargilyProvider(
      settings({ 'payments.chargily_enabled': true }),
      secrets({}),
    );
    expect(await provider.isConfigured()).toBe(false);
  });

  it('is configured when both are present', async () => {
    const provider = new ChargilyProvider(
      settings({ 'payments.chargily_enabled': true }),
      secrets({ 'payments.chargily_api_key': API_KEY }),
    );
    expect(await provider.isConfigured()).toBe(true);
  });
});

describe('ChargilyProvider — creating a checkout', () => {
  it('sends whole dinars, not centimes', async () => {
    // Sending 490000 here would charge the customer a hundred times the price.
    const http = vi.fn(async () =>
      response(200, { id: 'chk_1', checkout_url: 'https://pay.chargily.net/c/1', status: 'pending' }),
    ) as unknown as HttpClient;

    const provider = new ChargilyProvider(
      settings({ 'payments.chargily_enabled': true }),
      secrets({ 'payments.chargily_api_key': API_KEY }),
      http,
    );

    await provider.createSession(intent({ amountMinor: 490_000n }));

    const body = JSON.parse(
      ((http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1]
        .body as string,
    ) as { amount: number; currency: string };

    expect(body.amount).toBe(4900);
    expect(body.currency).toBe('dzd');
  });

  it('carries the order number in metadata so the webhook can find it again', async () => {
    const http = vi.fn(async () =>
      response(200, { id: 'chk_1', checkout_url: 'https://pay.chargily.net/c/1', status: 'pending' }),
    ) as unknown as HttpClient;

    const provider = new ChargilyProvider(
      settings({ 'payments.chargily_enabled': true }),
      secrets({ 'payments.chargily_api_key': API_KEY }),
      http,
    );

    await provider.createSession(intent());

    const body = JSON.parse(
      ((http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1]
        .body as string,
    ) as { metadata: Array<{ order_number: string }> };

    expect(body.metadata[0]?.order_number).toBe('JK-260910-0042');
  });

  it('returns the checkout url and the provider reference', async () => {
    const http = (async () =>
      response(200, {
        id: 'chk_42',
        checkout_url: 'https://pay.chargily.net/c/42',
        status: 'pending',
      })) as unknown as HttpClient;

    const provider = new ChargilyProvider(
      settings({ 'payments.chargily_enabled': true }),
      secrets({ 'payments.chargily_api_key': API_KEY }),
      http,
    );

    expect(await provider.createSession(intent())).toEqual({
      provider: 'chargily',
      checkoutUrl: 'https://pay.chargily.net/c/42',
      reference: 'chk_42',
      status: 'pending',
    });
  });

  it('refuses to create a session with no API key', async () => {
    const provider = new ChargilyProvider(settings(), secrets({}));
    await expect(provider.createSession(intent())).rejects.toBeInstanceOf(PaymentConfigurationError);
  });

  it('turns a rejection from the gateway into a configuration error', async () => {
    const http = (async () => response(401, { message: 'Unauthenticated' })) as unknown as HttpClient;
    const provider = new ChargilyProvider(
      settings({ 'payments.chargily_enabled': true }),
      secrets({ 'payments.chargily_api_key': API_KEY }),
      http,
    );
    await expect(provider.createSession(intent())).rejects.toBeInstanceOf(PaymentConfigurationError);
  });
});

describe('ChargilyProvider — webhooks', () => {
  const provider = () =>
    new ChargilyProvider(
      settings({ 'payments.chargily_enabled': true }),
      secrets({ 'payments.chargily_secret': SECRET }),
    );

  const sign = (body: string) => createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');

  const paidBody = JSON.stringify({
    type: 'checkout.paid',
    data: {
      id: 'chk_42',
      amount: 4900,
      status: 'paid',
      metadata: [{ order_number: 'JK-260910-0042' }],
    },
  });

  it('accepts a correctly signed body and converts the amount back to centimes', async () => {
    const result = await provider().parseWebhook(paidBody, { signature: sign(paidBody) });

    expect(result).toMatchObject({
      orderRef: 'JK-260910-0042',
      reference: 'chk_42',
      status: 'paid',
      amountMinor: 490_000n,
    });
  });

  it('refuses a body with no signature', async () => {
    await expect(provider().parseWebhook(paidBody, {})).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
  });

  it('refuses a body whose signature does not match', async () => {
    await expect(
      provider().parseWebhook(paidBody, { signature: sign('something else') }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('refuses a tampered body even when the original signature is replayed', async () => {
    // The attack this stops: take a real 49 DA payment and rewrite it as 4 900.
    const signature = sign(paidBody);
    const tampered = paidBody.replace('"amount":4900', '"amount":49');

    await expect(provider().parseWebhook(tampered, { signature })).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
  });

  it('refuses a signed body that names no order', async () => {
    const body = JSON.stringify({
      type: 'checkout.paid',
      data: { id: 'chk_1', amount: 100, status: 'paid' },
    });
    await expect(provider().parseWebhook(body, { signature: sign(body) })).rejects.toThrow(
      /no order reference/,
    );
  });

  it('reads metadata sent as an object rather than an array', async () => {
    const body = JSON.stringify({
      type: 'checkout.paid',
      data: {
        id: 'chk_9',
        amount: 100,
        status: 'paid',
        metadata: { order_number: 'JK-260101-0001' },
      },
    });
    const result = await provider().parseWebhook(body, { signature: sign(body) });
    expect(result.orderRef).toBe('JK-260101-0001');
  });

  it.each([
    ['paid', 'paid'],
    ['canceled', 'cancelled'],
    ['failed', 'failed'],
    ['expired', 'failed'],
    ['processing', 'pending'],
  ])('maps the gateway status %s to %s', async (given, expected) => {
    const body = JSON.stringify({
      type: 'checkout.updated',
      data: { id: 'chk_1', amount: 100, status: given, metadata: [{ order_number: 'JK-1' }] },
    });
    const result = await provider().parseWebhook(body, { signature: sign(body) });
    expect(result.status).toBe(expected);
  });

  it('refuses a webhook when the shop has no secret configured', async () => {
    const bare = new ChargilyProvider(settings(), secrets({}));
    await expect(bare.parseWebhook(paidBody, { signature: 'x' })).rejects.toBeInstanceOf(
      PaymentConfigurationError,
    );
  });
});

describe('constantTimeEquals', () => {
  it('matches identical strings', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings of the same length', () => {
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(constantTimeEquals('abc', 'abcdef')).toBe(false);
    expect(constantTimeEquals('', 'a')).toBe(false);
  });
});
