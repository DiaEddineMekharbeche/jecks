import net from 'node:net';
import tls from 'node:tls';
import type { OutgoingMessage } from './notifier.js';

/**
 * A small SMTP client that works against a real provider.
 *
 * The first version of this was a plain socket that wrote the next command whenever any
 * data arrived. That is enough for Mailpit and wrong for everything else: Gmail, Brevo
 * and every relay a shop would actually use insist on an encrypted connection, answer
 * EHLO with several lines, and reject a login sent in the clear. It also ignored the
 * username and password from the environment, so it could not have authenticated even
 * where it connected.
 *
 * What this does, and why each part is here:
 * - A reply is complete at the line whose fourth character is a space (`250 OK`), not at
 *   the end of a network chunk. `250-` lines continue it. One reply can arrive in
 *   several chunks and several replies in one.
 * - Port 465 is encrypted from the first byte (`secure`); port 587 starts in the clear
 *   and upgrades with STARTTLS when the server offers it.
 * - Credentials are sent only over an encrypted connection, or to this machine. A shop
 *   that points `SMTP_HOST` at a provider and forgets `SMTP_SECURE` gets an error that
 *   says so, not a password on the wire.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  password?: string;
  /** Encrypted from the first byte — port 465. Otherwise STARTTLS is used if offered. */
  secure?: boolean;
  /** Tests use a self-signed certificate; nothing else should turn this off. */
  rejectUnauthorized?: boolean;
  /** Per-reply timeout. */
  timeoutMs?: number;
}

interface Reply {
  code: number;
  lines: string[];
}

/** Reads replies off one socket. Replaced, not reused, after a STARTTLS upgrade. */
class Session {
  private buffer = '';
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null =
    null;
  private queued: Reply[] = [];
  private pending: string[] = [];
  private failure: Error | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public socket: net.Socket | tls.TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.attach(socket);
  }

  /** Points the reader at a (new) socket. */
  attach(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    this.buffer = '';
    socket.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed unexpectedly')));
  }

  private onData(text: string): void {
    this.buffer += text;

    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);

      this.pending.push(line);
      // `250-` continues a reply; `250 ` (or a bare `250`) ends it.
      if (/^\d{3}( |$)/.test(line)) {
        const reply: Reply = { code: Number(line.slice(0, 3)), lines: this.pending };
        this.pending = [];
        this.deliver(reply);
      }
    }
  }

  private deliver(reply: Reply): void {
    if (this.waiting) {
      const { resolve } = this.waiting;
      this.waiting = null;
      this.clearTimer();
      resolve(reply);
    } else {
      this.queued.push(reply);
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.clearTimer();
    if (this.waiting) {
      const { reject } = this.waiting;
      this.waiting = null;
      reject(error);
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  read(): Promise<Reply> {
    const ready = this.queued.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);

    return new Promise<Reply>((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.timer = setTimeout(() => this.fail(new Error('SMTP timed out')), this.timeoutMs);
    });
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  /** Sends a command and checks the reply code, so no step can pass on a refusal. */
  async command(
    line: string,
    expect: number[],
    label = line.split(' ')[0] ?? line,
  ): Promise<Reply> {
    this.write(line);
    return this.expect(expect, label);
  }

  async expect(expect: number[], label: string): Promise<Reply> {
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      // Never put the command itself in the error: for AUTH it is the password.
      throw new Error(`SMTP refused ${label}: ${reply.lines.join(' ').slice(0, 200)}`);
    }
    return reply;
  }

  close(): void {
    this.clearTimer();
    this.socket.destroy();
  }
}

export async function sendOverSmtp(config: SmtpConfig, message: OutgoingMessage): Promise<string> {
  const recipient = clean(message.recipient);
  const from = clean(config.from);
  const sender = addressOf(from);
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(recipient)) throw new Error('Not an e-mail address');
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(sender)) throw new Error('MAIL_FROM has no valid address');

  const timeoutMs = config.timeoutMs ?? 20_000;
  const rejectUnauthorized = config.rejectUnauthorized ?? true;

  const socket = config.secure
    ? tls.connect({
        host: config.host,
        port: config.port,
        servername: serverName(config.host),
        rejectUnauthorized,
      })
    : net.createConnection({ host: config.host, port: config.port });

  const session = new Session(socket, timeoutMs);
  const hostname = 'jecks';

  try {
    await session.expect([220], 'the greeting');

    let ehlo = await session.command(`EHLO ${hostname}`, [250], 'EHLO');
    let encrypted = Boolean(config.secure);

    if (!encrypted && advertises(ehlo, 'STARTTLS')) {
      await session.command('STARTTLS', [220], 'STARTTLS');
      // The raw socket now carries ciphertext; only the TLS layer may read it.
      session.socket.removeAllListeners('data');
      const upgraded = tls.connect({
        socket: session.socket as net.Socket,
        servername: serverName(config.host),
        rejectUnauthorized,
      });
      session.attach(upgraded);
      await new Promise<void>((resolve, reject) => {
        upgraded.once('secureConnect', resolve);
        upgraded.once('error', reject);
      });
      encrypted = true;
      // Whatever was advertised before the upgrade no longer counts.
      ehlo = await session.command(`EHLO ${hostname}`, [250], 'EHLO');
    }

    if (config.user && config.password) {
      if (!encrypted && !isLoopback(config.host)) {
        throw new Error(
          'Refusing to send the SMTP password over an unencrypted connection. ' +
            'Set SMTP_SECURE=true for port 465, or use a port that offers STARTTLS (587).',
        );
      }

      if (advertises(ehlo, 'AUTH', 'PLAIN')) {
        const token = Buffer.from(`\0${config.user}\0${config.password}`, 'utf8').toString(
          'base64',
        );
        await session.command(`AUTH PLAIN ${token}`, [235], 'AUTH');
      } else {
        await session.command('AUTH LOGIN', [334], 'AUTH');
        await session.command(Buffer.from(config.user, 'utf8').toString('base64'), [334], 'AUTH');
        await session.command(
          Buffer.from(config.password, 'utf8').toString('base64'),
          [235],
          'AUTH',
        );
      }
    }

    await session.command(`MAIL FROM:<${sender}>`, [250], 'MAIL FROM');
    await session.command(`RCPT TO:<${recipient}>`, [250, 251], 'RCPT TO');
    await session.command('DATA', [354], 'DATA');

    const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${domainOf(sender)}>`;
    const body = Buffer.from(message.body, 'utf8')
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');

    session.write(
      [
        `From: ${encodeAddressHeader(from)}`,
        `To: ${recipient}`,
        `Subject: ${encodeHeader(clean(message.subject ?? ''))}`,
        `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
        `Message-ID: ${messageId}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        body,
        '.',
      ].join('\r\n'),
    );
    await session.expect([250], 'the message');

    session.write('QUIT');
    return `smtp-${messageId.slice(1, -1)}`;
  } finally {
    session.close();
  }
}

/** Does the EHLO reply advertise a keyword (and, for AUTH, a mechanism)? */
function advertises(reply: Reply, keyword: string, mechanism?: string): boolean {
  return reply.lines.some((line) => {
    const rest = line.slice(4).trim().toUpperCase();
    if (rest !== keyword && !rest.startsWith(`${keyword} `) && !rest.startsWith(`${keyword}=`)) {
      return false;
    }
    return mechanism ? rest.split(/[ =]/).includes(mechanism) : true;
  });
}

/** SNI is a hostname; an IP address there is not permitted and is ignored by Node. */
function serverName(host: string): string | undefined {
  return net.isIP(host) ? undefined : host;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

/** A header or an address must never carry a line break: that is how mail is hijacked. */
function clean(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

function domainOf(address: string): string {
  return address.split('@')[1] ?? 'jecks';
}

/** RFC 2047 for a value that is not plain ASCII, which any French subject is not. */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** `Jeck's <a@b>` with a non-ASCII display name needs the name encoded, not the address. */
function encodeAddressHeader(from: string): string {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(from);
  if (!match) return from;
  const name = (match[1] ?? '').replace(/^"|"$/g, '');
  return name ? `${encodeHeader(name)} <${match[2]}>` : `<${match[2]}>`;
}
