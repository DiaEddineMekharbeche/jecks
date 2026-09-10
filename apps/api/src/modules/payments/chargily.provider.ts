import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SettingsAdminService } from '../system/settings-admin.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  PaymentConfigurationError,
  WebhookVerificationError,
  type PaymentIntent,
  type PaymentProvider,
  type PaymentSession,
  type WebhookResult,
} from './payment-provider.js';

/**
 * Chargily Pay — CIB and Edahabia cards, which is what online card payment means in
 * Algeria (PRD F-ST-45).
 *
 * Built against the documented v2 API. The HTTP client is injectable so the adapter can
 * be exercised against a stub: an integration that is only ever tested by making a real
 * payment is an integration nobody tests.
 *
 * Credentials come from Settings › Payments, encrypted at rest.
 */

const API_BASE = 'https://pay.chargily.net/api/v2';

export type HttpClient = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

interface ChargilyCheckoutResponse {
  id: string;
  checkout_url: string;
  status: string;
}

interface ChargilyWebhookBody {
  type: string;
  data: {
    id: string;
    amount: number;
    status: string;
    metadata?: Array<{ order_number?: string }> | { order_number?: string };
  };
}

@Injectable()
export class ChargilyProvider implements PaymentProvider {
  readonly key = 'chargily';
  readonly label = 'Chargily (CIB / Edahabia)';
  readonly redirects = true;

  private readonly logger = new Logger(ChargilyProvider.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly secrets: SettingsAdminService,
    /** Overridden in tests; defaults to the platform fetch. */
    private readonly http: HttpClient = (url, init) => fetch(url, init),
  ) {}

  async isConfigured(): Promise<boolean> {
    const enabled = await this.settings.get<boolean>('payments.chargily_enabled', false);
    if (!enabled) return false;
    return Boolean(await this.secrets.secret('payments.chargily_api_key'));
  }

  /**
   * Creates a checkout and hands back the URL to send the shopper to.
   *
   * Amounts go over as whole dinars: Chargily quotes in the major unit, and sending
   * centimes would charge a hundred times the price.
   */
  async createSession(intent: PaymentIntent): Promise<PaymentSession> {
    const apiKey = await this.secrets.secret('payments.chargily_api_key');
    if (!apiKey) throw new PaymentConfigurationError(this.key);

    const response = await this.http(`${API_BASE}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Number(intent.amountMinor / 100n),
        currency: intent.currency.toLowerCase(),
        success_url: intent.returnUrl,
        failure_url: `${intent.returnUrl}?status=failed`,
        webhook_endpoint: intent.webhookUrl,
        description: intent.description,
        metadata: [{ order_number: intent.orderNumber }],
        customer_name: intent.customerName,
        customer_phone: intent.customerPhone,
        ...(intent.customerEmail ? { customer_email: intent.customerEmail } : {}),
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      this.logger.error(`Chargily refused a checkout (${response.status}): ${body.slice(0, 300)}`);
      throw new PaymentConfigurationError(this.key);
    }

    const parsed = JSON.parse(body) as ChargilyCheckoutResponse;
    return {
      provider: this.key,
      checkoutUrl: parsed.checkout_url,
      reference: parsed.id,
      status: 'pending',
    };
  }

  /**
   * Verifies the `signature` header before reading a single field of the body.
   *
   * The signature is an HMAC of the raw body with the shop's webhook secret, compared
   * in constant time. Parsing first and verifying afterwards would mean acting on
   * attacker-controlled JSON, which is how a free order gets marked paid.
   */
  async parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookResult> {
    const secret = await this.secrets.secret('payments.chargily_secret');
    if (!secret) throw new PaymentConfigurationError(this.key);

    const provided = headerValue(headers, 'signature');
    if (!provided) throw new WebhookVerificationError('No signature header');

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    if (!constantTimeEquals(provided, expected)) {
      throw new WebhookVerificationError();
    }

    const body = JSON.parse(rawBody) as ChargilyWebhookBody;
    const orderNumber = orderNumberOf(body);
    if (!orderNumber) {
      throw new WebhookVerificationError('The webhook carries no order reference');
    }

    return {
      orderRef: orderNumber,
      reference: body.data.id,
      status: mapStatus(body.data.status),
      // Back to centimes: Chargily reports the major unit it charged.
      amountMinor: BigInt(Math.round(body.data.amount * 100)),
      raw: body,
    };
  }
}

function mapStatus(status: string): WebhookResult['status'] {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'expired':
      return 'failed';
    default:
      return 'pending';
  }
}

/** Metadata arrives as an array in v2 and as an object in older payloads. */
function orderNumberOf(body: ChargilyWebhookBody): string | null {
  const metadata = body.data.metadata;
  if (Array.isArray(metadata)) {
    return metadata.find((entry) => entry.order_number)?.order_number ?? null;
  }
  return metadata?.order_number ?? null;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Length-safe: `timingSafeEqual` throws on a mismatch, which would leak the length. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
