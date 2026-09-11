import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed links for documents — PRD Section 10.8 and M7.
 *
 * Labels, manifests and backups are not public, but they do have to leave the admin:
 * a label gets sent to a courier over WhatsApp, a manifest is printed from a phone.
 * A session cookie cannot travel that way, so the link carries its own proof.
 *
 * The token is the storage key and an expiry, signed with the credentials key. It is
 * opaque to the holder, cannot be edited without breaking the signature, and stops
 * working on its own. There is nothing to revoke and nothing to store.
 *
 * Implemented here rather than as an S3 presigned URL so the local driver behaves
 * identically — a shop on a single VPS gets the same guarantees as one on object
 * storage, and the code path is the one the tests exercise.
 */

/** Prefixes a signed link may point at. Anything else is refused before signing. */
const ALLOWED_PREFIXES = ['labels/', 'manifests/', 'backups/', 'exports/', 'media/'];

export interface SignedLink {
  token: string;
  expiresAt: string;
}

@Injectable()
export class DocumentLinksService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('CREDENTIALS_KEY') ?? '';
  }

  /**
   * Signs a key for a limited time.
   *
   * Fifteen minutes by default: long enough to print or forward, short enough that a
   * link pasted into a group chat is dead before it spreads.
   */
  sign(key: string, ttlSeconds = 900): SignedLink {
    if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      throw new BadRequestException({
        code: 'NOT_SIGNABLE',
        message: 'That document cannot be shared by link',
      });
    }

    // A traversal in the key would let a signed link reach outside the storage root.
    if (key.includes('..')) {
      throw new BadRequestException({ code: 'NOT_SIGNABLE', message: 'Invalid document key' });
    }

    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${key}:${expires}`;
    const signature = this.signature(payload);

    return {
      token: `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /**
   * Reads a token back, or throws.
   *
   * The signature is checked before the expiry so a tampered token and an expired one
   * are indistinguishable to the holder: telling them which would say whether the key
   * they guessed exists.
   */
  verify(token: string): string {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) throw this.invalid();

    const payload = Buffer.from(encoded, 'base64url').toString('utf8');
    if (!constantTimeEquals(signature, this.signature(payload))) throw this.invalid();

    const separator = payload.lastIndexOf(':');
    const key = payload.slice(0, separator);
    const expires = Number(payload.slice(separator + 1));

    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) throw this.invalid();
    if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) throw this.invalid();

    return key;
  }

  private signature(payload: string): string {
    return createHmac('sha256', this.secret).update(payload, 'utf8').digest('base64url');
  }

  private invalid(): BadRequestException {
    return new BadRequestException({
      code: 'LINK_INVALID',
      message: 'This link has expired or is not valid',
    });
  }
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
