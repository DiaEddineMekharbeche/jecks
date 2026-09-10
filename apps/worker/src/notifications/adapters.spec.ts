import { describe, expect, it, vi } from 'vitest';
import {
  HttpSmsNotifier,
  LogNotifier,
  SmtpNotifier,
  TelegramNotifier,
  TwilioSmsNotifier,
  WhatsAppCloudNotifier,
} from './adapters.js';
import { smsSegments, toE164Dz, toLocalDz, type HttpClient, type OutgoingMessage } from './notifier.js';

/**
 * Every transport, against a stubbed HTTP client.
 *
 * What breaks in an SMS integration is never the happy path: it is the phone format,
 * the character set, and what happens when the gateway says no. Those are what these
 * cover.
 */

function message(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    channel: 'SMS',
    recipient: '+213551234567',
    subject: null,
    body: 'Jecks: commande JK-260910-0042 confirmee.',
    locale: 'fr',
    event: 'order.confirmed',
    ...overrides,
  };
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('phone formats', () => {
  it('converts to the local form most Algerian gateways want', () => {
    expect(toLocalDz('+213551234567')).toBe('0551234567');
    expect(toLocalDz('213551234567')).toBe('0551234567');
    expect(toLocalDz('0551234567')).toBe('0551234567');
    expect(toLocalDz('0550 11 22 33')).toBe('0550112233');
  });

  it('converts to E.164 for the gateways that insist on it', () => {
    expect(toE164Dz('0551234567')).toBe('+213551234567');
    expect(toE164Dz('+213551234567')).toBe('+213551234567');
    expect(toE164Dz('213551234567')).toBe('+213551234567');
  });

  it('round-trips between the two forms', () => {
    expect(toLocalDz(toE164Dz('0770998877'))).toBe('0770998877');
  });
});

describe('smsSegments', () => {
  it('counts a short Latin message as one segment', () => {
    expect(smsSegments('Bonjour')).toEqual({ segments: 1, unicode: false });
  });

  it('counts 160 Latin characters as one, and 161 as two', () => {
    expect(smsSegments('a'.repeat(160)).segments).toBe(1);
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
  });

  it('drops to 70 characters once anything is outside the GSM alphabet', () => {
    // One accented or Arabic character switches the whole message to UCS-2, which is
    // the surprise on an owner's first bill.
    const arabic = 'مرحبا '.repeat(12);
    const result = smsSegments(arabic);
    expect(result.unicode).toBe(true);
    expect(result.segments).toBeGreaterThan(1);
  });

  it('keeps the accents GSM 03.38 actually contains out of unicode', () => {
    // é, è, à, ù and ç are all in the GSM alphabet, so a message using only those still
    // gets the full 160 characters. Treating them as unicode would overstate every bill.
    expect(smsSegments('Commande confirmée, à très vite').unicode).toBe(false);
  });

  it('treats an accent outside GSM 03.38 as unicode', () => {
    // ô and ê are not in the alphabet, and one of them costs the whole message 90
    // characters of headroom.
    expect(smsSegments('À bientôt').unicode).toBe(true);
    expect(smsSegments('Commande prête').unicode).toBe(true);
  });
});

describe('LogNotifier', () => {
  it('is always configured and always reports success', async () => {
    const lines: string[] = [];
    const notifier = new LogNotifier((line) => lines.push(line));

    expect(notifier.isConfigured()).toBe(true);
    expect(await notifier.send(message())).toEqual({ delivered: true, reference: null });
    expect(lines[0]).toContain('+213551234567');
    expect(lines[0]).toContain('order.confirmed');
  });

  it('reports the segment count so the owner can see what a message would cost', async () => {
    const lines: string[] = [];
    await new LogNotifier((line) => lines.push(line)).send(
      message({ body: 'مرحبا '.repeat(20) }),
    );
    // An Arabic message costs 70 characters a segment, and the log says so.
    expect(lines[0]).toContain('unicode');
    expect(lines[0]).toMatch(/[2-9] segment/);
  });
});

describe('TwilioSmsNotifier', () => {
  const config = { accountSid: 'AC123', authToken: 'token', from: '+15550000000' };

  it('needs all three credentials', () => {
    expect(new TwilioSmsNotifier(config).isConfigured()).toBe(true);
    expect(new TwilioSmsNotifier({ ...config, authToken: '' }).isConfigured()).toBe(false);
  });

  it('sends E.164 and returns the message id', async () => {
    const http = vi.fn(async () => respond(201, { sid: 'SM42' })) as unknown as HttpClient;
    const result = await new TwilioSmsNotifier(config, http).send(
      message({ recipient: '0551234567' }),
    );

    expect(result).toEqual({ delivered: true, reference: 'SM42' });

    const [url, init] = (http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain('/Accounts/AC123/Messages.json');
    expect(String(init.body)).toContain('To=%2B213551234567');
  });

  it('reports a refusal rather than throwing', async () => {
    const http = (async () => respond(400, { message: 'Invalid To' })) as unknown as HttpClient;
    const result = await new TwilioSmsNotifier(config, http).send(message());

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('400');
  });
});

describe('HttpSmsNotifier', () => {
  it('substitutes the phone and the message into a URL template', async () => {
    const http = vi.fn(async () => respond(200, 'OK')) as unknown as HttpClient;

    await new HttpSmsNotifier(
      { endpoint: 'https://sms.dz/send?to={phone}&text={message}' },
      http,
    ).send(message({ recipient: '+213551234567', body: 'Bonjour' }));

    const [url] = (http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    // Local format by default: most Algerian gateways reject +213.
    expect(url).toContain('to=0551234567');
    expect(url).toContain('text=Bonjour');
  });

  it('uses E.164 when the gateway asks for it', async () => {
    const http = vi.fn(async () => respond(200, 'OK')) as unknown as HttpClient;

    await new HttpSmsNotifier(
      { endpoint: 'https://sms.dz/send?to={phone}', localFormat: false },
      http,
    ).send(message());

    const [url] = (http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('to=%2B213551234567');
  });

  it('posts a JSON body when one is templated, with the raw placeholders', async () => {
    const http = vi.fn(async () => respond(200, 'OK')) as unknown as HttpClient;

    await new HttpSmsNotifier(
      {
        endpoint: 'https://sms.dz/api',
        bodyTemplate: '{"to":"{phone_raw}","msg":"{message_raw}"}',
      },
      http,
    ).send(message({ body: 'Bonjour "Yacine"' }));

    const [, init] = (http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe('POST');

    // The escaped quotes must survive into valid JSON, or the gateway rejects it.
    const parsed = JSON.parse(String(init.body)) as { to: string; msg: string };
    expect(parsed).toEqual({ to: '0551234567', msg: 'Bonjour "Yacine"' });
  });

  it('is unconfigured with no endpoint', () => {
    expect(new HttpSmsNotifier({ endpoint: '' }).isConfigured()).toBe(false);
  });

  it('reports the gateway’s refusal', async () => {
    const http = (async () => respond(403, 'Quota exceeded')) as unknown as HttpClient;
    const result = await new HttpSmsNotifier({ endpoint: 'https://sms.dz/send' }, http).send(
      message(),
    );
    expect(result).toMatchObject({ delivered: false });
    expect(result.error).toContain('Quota exceeded');
  });
});

describe('WhatsAppCloudNotifier', () => {
  const config = { phoneNumberId: '1234', accessToken: 'token' };

  it('sends the number with no plus and returns the message id', async () => {
    const http = vi.fn(async () => respond(200, { messages: [{ id: 'wamid.1' }] })) as unknown as HttpClient;

    const result = await new WhatsAppCloudNotifier(config, http).send(
      message({ channel: 'WHATSAPP', recipient: '0551234567' }),
    );

    expect(result).toEqual({ delivered: true, reference: 'wamid.1' });

    const [, init] = (http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as { to: string };
    expect(body.to).toBe('213551234567');
  });

  it('is unconfigured without a token', () => {
    expect(new WhatsAppCloudNotifier({ phoneNumberId: '1', accessToken: '' }).isConfigured()).toBe(
      false,
    );
  });
});

describe('TelegramNotifier', () => {
  const config = { token: 'bot:token', chatId: '-100123' };

  it('sends to the shop’s own chat, ignoring the recipient', async () => {
    const http = vi.fn(async () => respond(200, { result: { message_id: 7 } })) as unknown as HttpClient;

    const result = await new TelegramNotifier(config, http).send(
      message({ channel: 'TELEGRAM', recipient: 'ignored', subject: 'Nouvelle commande' }),
    );

    expect(result).toEqual({ delivered: true, reference: '7' });

    const [, init] = (http as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('-100123');
    expect(body.text).toContain('*Nouvelle commande*');
  });

  it('is unconfigured without a chat id', () => {
    expect(new TelegramNotifier({ token: 't', chatId: '' }).isConfigured()).toBe(false);
  });
});

describe('SmtpNotifier', () => {
  const config = { host: 'localhost', port: 1025, from: "Jeck's <no-reply@jecks.dz>" };

  it('is configured with a host and a sender', () => {
    expect(new SmtpNotifier(config).isConfigured()).toBe(true);
    expect(new SmtpNotifier({ ...config, host: '' }).isConfigured()).toBe(false);
  });

  it('refuses a recipient that is not an e-mail address', async () => {
    const result = await new SmtpNotifier(config, async () => 'id').send(
      message({ channel: 'EMAIL', recipient: '0551234567' }),
    );
    expect(result).toMatchObject({ delivered: false, error: 'Not an e-mail address' });
  });

  it('delegates to the transport and returns its reference', async () => {
    const result = await new SmtpNotifier(config, async () => 'smtp-1').send(
      message({ channel: 'EMAIL', recipient: 'yacine@example.dz' }),
    );
    expect(result).toEqual({ delivered: true, reference: 'smtp-1' });
  });

  it('turns a transport failure into a reported error rather than a throw', async () => {
    const result = await new SmtpNotifier(config, async () => {
      throw new Error('connection refused');
    }).send(message({ channel: 'EMAIL', recipient: 'yacine@example.dz' }));

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('connection refused');
  });
});
