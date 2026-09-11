import { describe, expect, it, vi } from 'vitest';
import {
  BrevoNewsletterProvider,
  LogNewsletterProvider,
  NewsletterConfigurationError,
  parseError,
  type NewsletterContact,
  type NewsletterHttpClient,
} from './newsletter-provider.js';

/**
 * The newsletter providers, against a stubbed HTTP client.
 *
 * The rules worth pinning down are the ones that decide whether somebody gets mailed
 * after asking not to be: an unsubscribe has to travel, and a phone-only subscriber has
 * to be counted rather than silently dropped.
 */

const contact = (overrides: Partial<NewsletterContact> = {}): NewsletterContact => ({
  email: 'yacine@example.dz',
  phone: '+213551234567',
  locale: 'fr',
  source: 'footer',
  unsubscribed: false,
  ...overrides,
});

function stub(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const http = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as NewsletterHttpClient;

  return { calls, http };
}

const body = (calls: Array<{ init: RequestInit }>, index = 0) =>
  JSON.parse(String(calls[index]!.init.body)) as {
    listIds: number[];
    updateExistingContacts: boolean;
    jsonBody: Array<{
      email: string;
      emailBlacklisted: boolean;
      attributes: Record<string, string | undefined>;
    }>;
  };

describe('LogNewsletterProvider', () => {
  const log = new LogNewsletterProvider();

  it('needs no credentials, so a shop can always press the button', () => {
    expect(log.requiredCredentials).toEqual([]);
  });

  it('counts the contacts it would have sent', async () => {
    const result = await log.sync([contact(), contact({ email: 'b@example.dz' })]);
    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('separates the unsubscribed rather than counting them as sent', async () => {
    const result = await log.sync([contact(), contact({ unsubscribed: true })]);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('handles an empty list', async () => {
    expect((await log.sync([])).sent).toBe(0);
  });
});

describe('BrevoNewsletterProvider', () => {
  const credentials = { apiKey: 'key-123', listId: '7' };

  it('refuses before making a request when a credential is missing', async () => {
    const { calls, http } = stub(200, {});
    await expect(new BrevoNewsletterProvider(http).sync([contact()], { apiKey: 'k' })).rejects.toThrow(
      NewsletterConfigurationError,
    );
    expect(calls).toHaveLength(0);
  });

  it('sends the API key in their header', async () => {
    const { calls, http } = stub(200, { processId: 1 });
    await new BrevoNewsletterProvider(http).sync([contact()], credentials);

    expect((calls[0]!.init.headers as Record<string, string>)['api-key']).toBe('key-123');
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/contacts/import');
  });

  it('targets the configured list as a number', async () => {
    const { calls, http } = stub(200, { processId: 1 });
    await new BrevoNewsletterProvider(http).sync([contact()], credentials);

    expect(body(calls).listIds).toEqual([7]);
    expect(body(calls).updateExistingContacts).toBe(true);
  });

  it('carries the phone and the language across', async () => {
    const { calls, http } = stub(200, { processId: 1 });
    await new BrevoNewsletterProvider(http).sync([contact({ locale: 'ar' })], credentials);

    expect(body(calls).jsonBody[0]!.attributes.SMS).toBe('+213551234567');
    expect(body(calls).jsonBody[0]!.attributes.LANGUAGE).toBe('AR');
  });

  it('blacklists an unsubscriber rather than leaving them out', async () => {
    // Leaving them out would let the next sync re-add them and mail them again.
    const { calls, http } = stub(200, { processId: 1 });
    await new BrevoNewsletterProvider(http).sync([contact({ unsubscribed: true })], credentials);

    expect(body(calls).jsonBody[0]!.emailBlacklisted).toBe(true);
  });

  it('counts a phone-only subscriber as skipped, never as sent', async () => {
    const { calls, http } = stub(200, { processId: 1 });
    const result = await new BrevoNewsletterProvider(http).sync(
      [contact(), contact({ email: null })],
      credentials,
    );

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(body(calls).jsonBody).toHaveLength(1);
  });

  it('makes no request at all for a list of phone-only subscribers', async () => {
    const { calls, http } = stub(200, {});
    const result = await new BrevoNewsletterProvider(http).sync(
      [contact({ email: null })],
      credentials,
    );

    expect(calls).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('sends a hundred at a time', async () => {
    const { calls, http } = stub(200, { processId: 1 });
    const many = Array.from({ length: 250 }, (_, index) =>
      contact({ email: `person${index}@example.dz` }),
    );

    const result = await new BrevoNewsletterProvider(http).sync(many, credentials);

    expect(calls).toHaveLength(3);
    expect(body(calls, 0).jsonBody).toHaveLength(100);
    expect(body(calls, 2).jsonBody).toHaveLength(50);
    expect(result.sent).toBe(250);
  });

  it('keeps the batches that worked when one is refused', async () => {
    let call = 0;
    const http = (async () => {
      call += 1;
      const failing = call === 2;
      return {
        ok: !failing,
        status: failing ? 400 : 200,
        text: async () => (failing ? JSON.stringify({ message: 'Invalid email' }) : '{}'),
      };
    }) as unknown as NewsletterHttpClient;

    const many = Array.from({ length: 250 }, (_, index) =>
      contact({ email: `person${index}@example.dz` }),
    );

    const result = await new BrevoNewsletterProvider(http).sync(many, credentials);

    expect(result.sent).toBe(150);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Invalid email');
  });

  it('reports nothing sent for an empty list', async () => {
    const { calls, http } = stub(200, {});
    expect((await new BrevoNewsletterProvider(http).sync([], credentials)).sent).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('parseError', () => {
  it('prefers their own message', () => {
    expect(parseError(JSON.stringify({ message: 'Invalid API key' }))).toBe('Invalid API key');
  });

  it('falls back to a code', () => {
    expect(parseError(JSON.stringify({ code: 'unauthorized' }))).toBe('unauthorized');
  });

  it('passes a non-JSON body through', () => {
    expect(parseError('<html>gateway</html>')).toContain('gateway');
  });

  it('says something for an empty body', () => {
    expect(parseError('')).toBe('no detail');
  });
});
