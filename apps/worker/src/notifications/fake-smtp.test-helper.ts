import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';

/**
 * A mail server that follows the protocol closely enough to catch a client that does
 * not: multi-line EHLO replies, STARTTLS, AUTH, and refusals on demand. Used by the SMTP
 * client's tests and by the dispatcher's, so what is exercised is a real socket.
 */

export interface FakeSmtpOptions {
  /** Encrypted from the first byte, like port 465. */
  secure?: boolean;
  /** Advertise and honour STARTTLS, like port 587. */
  startTls?: boolean;
  /** Mechanisms listed on the AUTH line. Empty means the server offers no login. */
  auth?: string[];
  /** Credentials the server accepts. */
  user?: string;
  password?: string;
  /** Refuse this command (matched by prefix) with a 550. */
  refuse?: string;
  /** Split every reply into one-byte chunks, to prove replies are not read per chunk. */
  dribble?: boolean;
  bind?: string;
}

export interface Received {
  from: string | null;
  to: string[];
  /** The decoded text/plain body. */
  body: string;
  headers: Record<string, string>;
  raw: string;
}

export interface FakeSmtp {
  port: number;
  host: string;
  transcript: string[];
  messages: Received[];
  close(): Promise<void>;
}

export function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A throwaway self-signed certificate, generated at test time and never committed. */
function makeCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'jecks-smtp-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(dir, 'k.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'c.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const transcript: string[] = [];
  const messages: Received[] = [];
  const credentials = options.startTls || options.secure ? makeCertificate() : null;
  const host = options.bind ?? '127.0.0.1';

  const handle = (initial: net.Socket) => {
    let socket: net.Socket = initial;
    let buffer = '';
    let encrypted = Boolean(options.secure);
    let authed = !options.user;
    let mailFrom: string | null = null;
    let rcpt: string[] = [];
    let data: string[] | null = null;
    let authStep: 'user' | 'pass' | null = null;
    let authUser = '';

    const say = (text: string) => {
      const out = `${text}\r\n`;
      transcript.push(`S: ${text}`);
      if (options.dribble) for (const char of out) socket.write(char);
      else socket.write(out);
    };

    const ehlo = () => {
      const lines = ['localhost greets you', '8BITMIME', 'SIZE 10485760'];
      if (options.startTls && !encrypted) lines.push('STARTTLS');
      if (options.auth?.length) lines.push(`AUTH ${options.auth.join(' ')}`);
      lines.forEach((line, index) => say(`250${index === lines.length - 1 ? ' ' : '-'}${line}`));
    };

    const onLine = (line: string) => {
      if (data) {
        if (line === '.') {
          const raw = data.join('\r\n');
          const [head = '', ...rest] = raw.split('\r\n\r\n');
          const headers: Record<string, string> = {};
          for (const row of head.split('\r\n')) {
            const at = row.indexOf(':');
            if (at > 0) headers[row.slice(0, at).toLowerCase()] = row.slice(at + 1).trim();
          }
          const encoded = rest.join('\r\n').replace(/\s+/g, '');
          messages.push({
            from: mailFrom,
            to: rcpt,
            headers,
            raw,
            body:
              headers['content-transfer-encoding'] === 'base64'
                ? Buffer.from(encoded, 'base64').toString('utf8')
                : rest.join('\r\n'),
          });
          data = null;
          say('250 queued');
        } else {
          data.push(line.startsWith('..') ? line.slice(1) : line);
        }
        return;
      }

      // The client's lines are logged, but a password is never written into a log.
      transcript.push(authStep ? 'C: <credential>' : `C: ${line}`);

      if (authStep === 'user') {
        authUser = Buffer.from(line, 'base64').toString('utf8');
        authStep = 'pass';
        say('334 UGFzc3dvcmQ6');
        return;
      }
      if (authStep === 'pass') {
        const pass = Buffer.from(line, 'base64').toString('utf8');
        authStep = null;
        if (authUser === options.user && pass === options.password) {
          authed = true;
          say('235 2.7.0 Accepted');
        } else say('535 5.7.8 Bad credentials');
        return;
      }

      const upper = line.toUpperCase();
      if (options.refuse && upper.startsWith(options.refuse.toUpperCase())) {
        say('550 5.1.1 Refused on purpose');
        return;
      }

      if (upper.startsWith('EHLO')) return ehlo();
      if (upper === 'STARTTLS') {
        say('220 Ready to start TLS');
        const secured = new tls.TLSSocket(socket, { isServer: true, ...credentials! });
        secured.on('data', onData);
        socket.removeAllListeners('data');
        socket = secured;
        encrypted = true;
        buffer = '';
        return;
      }
      if (upper.startsWith('AUTH PLAIN')) {
        const [, user, pass] = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0');
        if (user === options.user && pass === options.password) {
          authed = true;
          say('235 2.7.0 Accepted');
        } else say('535 5.7.8 Bad credentials');
        return;
      }
      if (upper === 'AUTH LOGIN') {
        authStep = 'user';
        say('334 VXNlcm5hbWU6');
        return;
      }
      if (upper.startsWith('MAIL FROM:')) {
        if (!authed) return say('530 5.7.0 Authentication required');
        mailFrom = /<([^>]*)>/.exec(line)?.[1] ?? null;
        rcpt = [];
        return say('250 OK');
      }
      if (upper.startsWith('RCPT TO:')) {
        rcpt.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
        return say('250 OK');
      }
      if (upper === 'DATA') {
        data = [];
        return say('354 End data with <CR><LF>.<CR><LF>');
      }
      if (upper === 'QUIT') {
        say('221 Bye');
        socket.end();
        return;
      }
      say('502 Command not implemented');
    };

    function onData(chunk: Buffer): void {
      buffer += chunk.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        onLine(line);
      }
    }

    socket.on('data', onData);
    socket.on('error', () => undefined);
    say('220 localhost ESMTP ready');
  };

  const server = options.secure
    ? tls.createServer({ ...credentials! }, handle as (socket: tls.TLSSocket) => void)
    : net.createServer(handle);

  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    host,
    transcript,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
