import {
  defaultHttp,
  smsSegments,
  toE164Dz,
  toLocalDz,
  type Channel,
  type DeliveryResult,
  type HttpClient,
  type Notifier,
  type OutgoingMessage,
} from './notifier.js';

/**
 * The transports — PRD Section 6.1.
 *
 * Each one is real: it builds the request its gateway documents and reports what came
 * back. The HTTP client is injected so every adapter is exercised in the test suite
 * without a live account, which is the difference between an adapter that compiles and
 * an adapter that works.
 */

// --- log --------------------------------------------------------------------

/**
 * The default. Writes what would have been sent and reports success.
 *
 * A shop with no SMS contract still needs the whole order flow to work, and the owner
 * needs to see the messages the system decided to send. A silent no-op would hide both.
 */
export class LogNotifier implements Notifier {
  readonly key = 'log';
  readonly channels: Channel[] = ['SMS', 'EMAIL', 'WHATSAPP', 'TELEGRAM', 'IN_APP'];

  constructor(private readonly write: (line: string, message: OutgoingMessage) => void = () => {}) {}

  isConfigured(): boolean {
    return true;
  }

  async send(message: OutgoingMessage): Promise<DeliveryResult> {
    const { segments, unicode } = smsSegments(message.body);
    this.write(
      `[${message.channel}] -> ${message.recipient} (${message.event}, ${segments} segment(s)${unicode ? ', unicode' : ''}): ${message.body}`,
      message,
    );
    return { delivered: true, reference: null };
  }
}

// --- SMTP -------------------------------------------------------------------

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  password?: string;
  secure?: boolean;
}

/**
 * E-mail over SMTP, spoken directly.
 *
 * A mail library would be four hundred kilobytes of dependency for one verb against
 * Mailpit in development and one relay in production. The conversation is a dozen
 * lines, and writing it here means the adapter has no supply chain of its own.
 */
export class SmtpNotifier implements Notifier {
  readonly key = 'smtp';
  readonly channels: Channel[] = ['EMAIL'];

  constructor(
    private readonly config: SmtpConfig,
    /** Injected in tests; the real one opens a socket. */
    private readonly transport: (config: SmtpConfig, message: OutgoingMessage) => Promise<string> = sendOverSmtp,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.host && this.config.from);
  }

  async send(message: OutgoingMessage): Promise<DeliveryResult> {
    if (!message.recipient.includes('@')) {
      return { delivered: false, reference: null, error: 'Not an e-mail address' };
    }
    try {
      return { delivered: true, reference: await this.transport(this.config, message) };
    } catch (error) {
      return { delivered: false, reference: null, error: String(error) };
    }
  }
}

/**
 * Minimal ESMTP over a plain socket.
 *
 * Deliberately small: EHLO, optional AUTH LOGIN, MAIL FROM, RCPT TO, DATA. Enough for
 * Mailpit and for a relay that accepts a plain login, which is what a single-VPS shop
 * actually has.
 */
async function sendOverSmtp(config: SmtpConfig, message: OutgoingMessage): Promise<string> {
  const net = await import('node:net');

  return new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    const steps: string[] = [`EHLO jecks`];

    if (config.user && config.password) {
      steps.push(
        'AUTH LOGIN',
        Buffer.from(config.user).toString('base64'),
        Buffer.from(config.password).toString('base64'),
      );
    }

    steps.push(
      `MAIL FROM:<${addressOf(config.from)}>`,
      `RCPT TO:<${message.recipient}>`,
      'DATA',
      [
        `From: ${config.from}`,
        `To: ${message.recipient}`,
        `Subject: ${encodeHeader(message.subject ?? '')}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(message.body, 'utf8').toString('base64'),
        '.',
      ].join('\r\n'),
      'QUIT',
    );

    let index = -1;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(15_000, () => fail(new Error('SMTP timed out')));
    socket.on('error', fail);

    socket.on('data', (chunk: Buffer) => {
      const reply = chunk.toString();
      // 4xx and 5xx are refusals; anything else is the server inviting the next step.
      if (/^[45]\d\d/.test(reply)) {
        fail(new Error(`SMTP refused: ${reply.trim().slice(0, 200)}`));
        return;
      }

      index += 1;
      const next = steps[index];
      if (next === undefined) {
        if (settled) return;
        settled = true;
        socket.end();
        resolve(`smtp-${Date.now()}`);
        return;
      }
      socket.write(`${next}\r\n`);
    });
  });
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

/** RFC 2047 for a subject that is not plain ASCII, which any French one is not. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

// --- Twilio -----------------------------------------------------------------

export class TwilioSmsNotifier implements Notifier {
  readonly key = 'twilio';
  readonly channels: Channel[] = ['SMS'];

  constructor(
    private readonly config: { accountSid: string; authToken: string; from: string },
    private readonly http: HttpClient = defaultHttp,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.accountSid && this.config.authToken && this.config.from);
  }

  async send(message: OutgoingMessage): Promise<DeliveryResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    const response = await this.http(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        // Twilio is one of the gateways that wants E.164.
        To: toE164Dz(message.recipient),
        From: this.config.from,
        Body: message.body,
      }).toString(),
    });

    const text = await response.text();
    if (!response.ok) {
      return { delivered: false, reference: null, error: `${response.status}: ${text.slice(0, 200)}` };
    }

    const parsed = JSON.parse(text) as { sid?: string };
    return { delivered: true, reference: parsed.sid ?? null };
  }
}

// --- generic HTTP gateway ---------------------------------------------------

export interface HttpSmsConfig {
  /** Endpoint with `{phone}` and `{message}` placeholders, or a plain URL. */
  endpoint: string;
  method?: 'GET' | 'POST';
  /** JSON body template; the same placeholders are substituted. */
  bodyTemplate?: string;
  headers?: Record<string, string>;
  /** Most Algerian gateways want `0…` rather than `+213…`. */
  localFormat?: boolean;
}

/**
 * The adapter most Algerian shops actually use.
 *
 * Local SMS gateways have no common API: each publishes a URL that takes a phone and a
 * message, and that is all. A configurable template covers them without a new adapter
 * per provider, and the owner fills it in from Settings › Notifications.
 */
export class HttpSmsNotifier implements Notifier {
  readonly key = 'http';
  readonly channels: Channel[] = ['SMS'];

  constructor(
    private readonly config: HttpSmsConfig,
    private readonly http: HttpClient = defaultHttp,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.endpoint);
  }

  async send(message: OutgoingMessage): Promise<DeliveryResult> {
    const phone = this.config.localFormat === false
      ? toE164Dz(message.recipient)
      : toLocalDz(message.recipient);

    const fill = (template: string) =>
      template
        .replaceAll('{phone}', encodeURIComponent(phone))
        .replaceAll('{message}', encodeURIComponent(message.body))
        // The raw forms exist for a JSON body, where percent-encoding would be wrong.
        .replaceAll('{phone_raw}', phone)
        .replaceAll('{message_raw}', jsonEscape(message.body));

    const method = this.config.method ?? (this.config.bodyTemplate ? 'POST' : 'GET');

    const response = await this.http(fill(this.config.endpoint), {
      method,
      headers: {
        ...(this.config.bodyTemplate ? { 'Content-Type': 'application/json' } : {}),
        ...this.config.headers,
      },
      ...(this.config.bodyTemplate ? { body: fill(this.config.bodyTemplate) } : {}),
    });

    const text = await response.text();
    return response.ok
      ? { delivered: true, reference: null }
      : { delivered: false, reference: null, error: `${response.status}: ${text.slice(0, 200)}` };
  }
}

// --- WhatsApp ---------------------------------------------------------------

export class WhatsAppCloudNotifier implements Notifier {
  readonly key = 'whatsapp';
  readonly channels: Channel[] = ['WHATSAPP'];

  constructor(
    private readonly config: { phoneNumberId: string; accessToken: string },
    private readonly http: HttpClient = defaultHttp,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.phoneNumberId && this.config.accessToken);
  }

  async send(message: OutgoingMessage): Promise<DeliveryResult> {
    const response = await this.http(
      `https://graph.facebook.com/v20.0/${this.config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          // WhatsApp wants the number with no plus and no leading zero.
          to: toE164Dz(message.recipient).replace('+', ''),
          type: 'text',
          text: { body: message.body },
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      return { delivered: false, reference: null, error: `${response.status}: ${text.slice(0, 200)}` };
    }

    const parsed = JSON.parse(text) as { messages?: Array<{ id: string }> };
    return { delivered: true, reference: parsed.messages?.[0]?.id ?? null };
  }
}

// --- Telegram ---------------------------------------------------------------

/**
 * Owner alerts over Telegram.
 *
 * Not for customers: it is how the owner learns about a new order or a stock-out on
 * their phone without paying for an SMS to themselves.
 */
export class TelegramNotifier implements Notifier {
  readonly key = 'telegram';
  readonly channels: Channel[] = ['TELEGRAM'];

  constructor(
    private readonly config: { token: string; chatId: string },
    private readonly http: HttpClient = defaultHttp,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.token && this.config.chatId);
  }

  async send(message: OutgoingMessage): Promise<DeliveryResult> {
    const response = await this.http(
      `https://api.telegram.org/bot${this.config.token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The recipient is ignored: an owner alert goes to the shop's own chat.
          chat_id: this.config.chatId,
          text: message.subject ? `*${message.subject}*\n${message.body}` : message.body,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      return { delivered: false, reference: null, error: `${response.status}: ${text.slice(0, 200)}` };
    }

    const parsed = JSON.parse(text) as { result?: { message_id?: number } };
    return { delivered: true, reference: String(parsed.result?.message_id ?? '') || null };
  }
}

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}
