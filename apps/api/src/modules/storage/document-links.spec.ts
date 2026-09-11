import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { DocumentLinksService } from './document-links.service.js';

/**
 * Signed document links.
 *
 * The whole value of these is that they cannot be edited and they stop working. Both
 * are tested directly, along with the two ways somebody would try to reach outside the
 * storage root.
 */

function service(secret = 'test-credentials-key'): DocumentLinksService {
  const config = { get: vi.fn(() => secret) } as unknown as ConfigService;
  return new DocumentLinksService(config);
}

describe('DocumentLinksService', () => {
  it('signs and reads back a key', () => {
    const links = service();
    const { token } = links.sign('labels/JK-260910-0042.pdf');
    expect(links.verify(token)).toBe('labels/JK-260910-0042.pdf');
  });

  it('reports when the link stops working', () => {
    const { expiresAt } = service().sign('labels/a.pdf', 900);
    const seconds = (new Date(expiresAt).getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(880);
    expect(seconds).toBeLessThanOrEqual(900);
  });

  it('refuses an expired token', () => {
    const links = service();
    const { token } = links.sign('labels/a.pdf', -1);
    expect(() => links.verify(token)).toThrow(/expired|not valid/);
  });

  it('refuses a token edited to point somewhere else', () => {
    const links = service();
    const { token } = links.sign('labels/a.pdf');
    const [, signature] = token.split('.');

    const forged = `${Buffer.from('backups/everything.dump:99999999999', 'utf8').toString(
      'base64url',
    )}.${signature}`;

    expect(() => links.verify(forged)).toThrow();
  });

  it('refuses a token signed with a different key', () => {
    const { token } = service('one-key').sign('labels/a.pdf');
    expect(() => service('another-key').verify(token)).toThrow();
  });

  it('refuses a malformed token rather than crashing', () => {
    const links = service();
    expect(() => links.verify('')).toThrow();
    expect(() => links.verify('nodot')).toThrow();
    expect(() => links.verify('....')).toThrow();
  });

  it('will not sign a key outside the document prefixes', () => {
    const links = service();
    expect(() => links.sign('.env')).toThrow(/cannot be shared/);
    expect(() => links.sign('secrets/keys.json')).toThrow();
  });

  it('will not sign a traversal', () => {
    expect(() => service().sign('labels/../../etc/passwd')).toThrow(/Invalid document key/);
  });

  it('signs the prefixes documents actually live under', () => {
    const links = service();
    for (const key of [
      'labels/a.pdf',
      'manifests/T-260911-1.pdf',
      'backups/2026-09-11.dump',
      'exports/sales.csv',
      'media/cap.jpg',
    ]) {
      expect(() => links.sign(key)).not.toThrow();
    }
  });

  it('gives the same answer for a forged token and an expired one', () => {
    // Distinguishing them would tell a holder whether the key they guessed exists.
    const links = service();
    const expired = links.sign('labels/a.pdf', -1).token;

    let expiredMessage = '';
    let forgedMessage = '';
    try {
      links.verify(expired);
    } catch (error) {
      expiredMessage = (error as Error).message;
    }
    try {
      links.verify('aaaa.bbbb');
    } catch (error) {
      forgedMessage = (error as Error).message;
    }

    expect(expiredMessage).toBe(forgedMessage);
  });
});
