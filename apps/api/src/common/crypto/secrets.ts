import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for credentials at rest — courier API keys, SMS gateway secrets,
 * payment provider keys (PRD Section 10.8).
 *
 * AES-256-GCM: the tag is what makes a tampered ciphertext fail loudly instead of
 * decrypting to garbage that some HTTP client then sends to a third party.
 *
 * The stored form is `v1:<iv>:<tag>:<ciphertext>`, all base64url. Versioning the prefix
 * now means a future key rotation can read both formats rather than needing a migration
 * that has to decrypt every row with a key nobody wrote down.
 */

const PREFIX = 'v1';
const IV_BYTES = 12;

/** Derives a 32-byte key from whatever length `CREDENTIALS_KEY` happens to be. */
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, b64(iv), b64(tag), b64(ciphertext)].join(':');
}

export function decryptSecret(stored: string, secret: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Stored secret is not in the expected format');
  }
  const [, iv, tag, ciphertext] = parts as [string, string, string, string];

  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), unb64(iv));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(ciphertext)), decipher.final()]).toString('utf8');
}

/** True for a value this module produced, so a plaintext legacy row is recognisable. */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`) && value.split(':').length === 4;
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function unb64(text: string): Buffer {
  return Buffer.from(text, 'base64url');
}
