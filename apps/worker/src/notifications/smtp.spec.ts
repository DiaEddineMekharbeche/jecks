import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeSmtp, opensslAvailable, type FakeSmtp } from './fake-smtp.test-helper.js';
import { encodeHeader, sendOverSmtp, type SmtpConfig } from './smtp.js';
import type { OutgoingMessage } from './notifier.js';

/**
 * The SMTP client against a server that behaves like a real one. The earlier version
 * advanced one step per network chunk, which passes against Mailpit and fails against
 * every provider that answers EHLO with several lines or insists on encryption.
 */

const message = (overrides: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  channel: 'EMAIL',
  recipient: 'owner@example.com',
  subject: 'Nouvelle commande JK-1 — 4 200 DA',
  body: 'Client : Amel Zidane\nTotal : 4 200 DA\n.\nune ligne qui ne contient qu’un point au-dessus',
  locale: 'fr',
  event: 'owner.new_order',
  ...overrides,
});

const config = (server: FakeSmtp, extra: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: server.host,
  port: server.port,
  from: "Jeck's <shop@example.com>",
  timeoutMs: 5_000,
  // The test certificate is self-signed, so verification is off here and nowhere else.
  rejectUnauthorized: false,
  ...extra,
});

let server: FakeSmtp | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('sendOverSmtp — plain connection', () => {
  it('delivers a message and reports a reference', async () => {
    server = await startFakeSmtp();
    const reference = await sendOverSmtp(config(server), message());

    expect(reference).toMatch(/^smtp-/);
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]!.from).toBe('shop@example.com');
    expect(server.messages[0]!.to).toEqual(['owner@example.com']);
  });

  it('carries the body intact, including a line that is only a dot', async () => {
    server = await startFakeSmtp();
    await sendOverSmtp(config(server), message());

    // Base64 is what protects this: a bare "." in plain text would end the message early.
    expect(server.messages[0]!.body).toBe(message().body);
  });

  it('sends the designed version alongside the plain text, not instead of it', async () => {
    server = await startFakeSmtp();
    await sendOverSmtp(
      config(server),
      message({ html: '<p style="color:red">Nouvelle commande — 4 200 DA</p>' }),
    );

    const mail = server.messages[0]!;
    expect(mail.headers['content-type']).toMatch(/^multipart\/alternative; boundary=/);
    expect(mail.body).toBe(message().body);
    expect(mail.html).toBe('<p style="color:red">Nouvelle commande — 4 200 DA</p>');
    // Plain text first: a client shows the last alternative it understands.
    expect(mail.raw.indexOf('text/plain')).toBeLessThan(mail.raw.indexOf('text/html'));
  });

  it('sends a message with no designed version as plain text, as before', async () => {
    server = await startFakeSmtp();
    await sendOverSmtp(config(server), message());

    expect(server.messages[0]!.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(server.messages[0]!.html).toBeNull();
  });

  it('encodes a non-ASCII subject and keeps the display name readable', async () => {
    server = await startFakeSmtp();
    await sendOverSmtp(config(server), message({ subject: 'Commande à confirmer' }));

    const headers = server.messages[0]!.headers;
    expect(headers.subject).toBe(encodeHeader('Commande à confirmer'));
    expect(headers.subject?.startsWith('=?UTF-8?B?')).toBe(true);
    expect(headers.from).toBe("Jeck's <shop@example.com>");
    expect(headers['message-id']).toMatch(/^<.+@example\.com>$/);
    expect(headers.date).toBeTruthy();
  });

  it('reads multi-line replies that arrive a byte at a time', async () => {
    // EHLO answers with several `250-` lines. A client that treats each network chunk as
    // one reply desynchronises here and sends commands into the wrong state.
    server = await startFakeSmtp({ dribble: true });
    await sendOverSmtp(config(server), message());

    expect(server.messages).toHaveLength(1);
  });

  it('stops on a refusal and says which step', async () => {
    server = await startFakeSmtp({ refuse: 'RCPT TO' });

    await expect(sendOverSmtp(config(server), message())).rejects.toThrow(/refused RCPT TO.*550/);
    expect(server.messages).toHaveLength(0);
  });

  it('refuses a recipient that is not an address, before connecting to anything', async () => {
    server = await startFakeSmtp();
    await expect(
      sendOverSmtp(config(server), message({ recipient: 'not an address' })),
    ).rejects.toThrow('Not an e-mail address');
    expect(server.transcript).toHaveLength(0);
  });

  it('cannot be tricked into a second header by a line break in the subject', async () => {
    server = await startFakeSmtp();
    await sendOverSmtp(config(server), message({ subject: 'Hello\r\nBcc: attacker@evil.test' }));

    expect(server.messages[0]!.headers.bcc).toBeUndefined();
    expect(server.messages[0]!.to).toEqual(['owner@example.com']);
  });
});

describe('sendOverSmtp — login', () => {
  it('logs in with AUTH PLAIN to a loopback server', async () => {
    server = await startFakeSmtp({ auth: ['PLAIN', 'LOGIN'], user: 'shop', password: 's3cret' });
    await sendOverSmtp(config(server, { user: 'shop', password: 's3cret' }), message());

    expect(server.messages).toHaveLength(1);
  });

  it('falls back to AUTH LOGIN when PLAIN is not offered', async () => {
    server = await startFakeSmtp({ auth: ['LOGIN'], user: 'shop', password: 's3cret' });
    await sendOverSmtp(config(server, { user: 'shop', password: 's3cret' }), message());

    expect(server.messages).toHaveLength(1);
  });

  it('reports a wrong password without printing it', async () => {
    server = await startFakeSmtp({ auth: ['PLAIN'], user: 'shop', password: 's3cret' });

    const failure = sendOverSmtp(
      config(server, { user: 'shop', password: 'wrong-password' }),
      message(),
    );
    await expect(failure).rejects.toThrow(/refused AUTH.*535/);
    await failure.catch((error: Error) => expect(error.message).not.toContain('wrong-password'));
  });

  it('refuses to send a password over an unencrypted connection to another machine', async () => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((address) => address && address.family === 'IPv4' && !address.internal);
    if (!lan) return; // No external interface to bind to on this machine.

    server = await startFakeSmtp({
      bind: lan.address,
      auth: ['PLAIN'],
      user: 'shop',
      password: 's3cret',
    });
    await expect(
      sendOverSmtp(config(server, { user: 'shop', password: 's3cret' }), message()),
    ).rejects.toThrow(/unencrypted connection/);

    // The password never left: the server saw EHLO and nothing after it.
    expect(server.transcript.some((line) => line.startsWith('C: AUTH'))).toBe(false);
  });
});

describe.skipIf(!opensslAvailable())('sendOverSmtp — encrypted', () => {
  it('works over an encrypted connection from the first byte (port 465)', async () => {
    server = await startFakeSmtp({
      secure: true,
      auth: ['PLAIN'],
      user: 'shop',
      password: 's3cret',
    });
    await sendOverSmtp(
      config(server, { secure: true, user: 'shop', password: 's3cret' }),
      message(),
    );

    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]!.body).toBe(message().body);
  });

  it('upgrades with STARTTLS (port 587) and then logs in', async () => {
    server = await startFakeSmtp({
      startTls: true,
      auth: ['PLAIN'],
      user: 'shop',
      password: 's3cret',
    });
    await sendOverSmtp(config(server, { user: 'shop', password: 's3cret' }), message());

    expect(server.messages).toHaveLength(1);
    // EHLO again after the upgrade: what a server advertised before it no longer counts.
    expect(server.transcript.filter((line) => line.startsWith('C: EHLO'))).toHaveLength(2);
    expect(server.transcript.indexOf('S: 220 Ready to start TLS')).toBeLessThan(
      server.transcript.lastIndexOf('C: EHLO jecks'),
    );
  });

  it('refuses a certificate it cannot verify unless told otherwise', async () => {
    server = await startFakeSmtp({ secure: true });

    await expect(
      sendOverSmtp(config(server, { secure: true, rejectUnauthorized: true }), message()),
    ).rejects.toThrow(/self[- ]signed|certificate/i);
    expect(server.messages).toHaveLength(0);
  });
});

describe('encodeHeader', () => {
  it('leaves ASCII alone and wraps anything else', () => {
    expect(encodeHeader('Plain subject')).toBe('Plain subject');
    expect(encodeHeader('Été')).toBe(`=?UTF-8?B?${Buffer.from('Été').toString('base64')}?=`);
  });
});
