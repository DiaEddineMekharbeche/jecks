import { createDecipheriv, createHash } from 'node:crypto';
import type { PrismaClient } from '@jecks/db';

/**
 * Reads a credential the admin encrypted — PRD Section 10.8.
 *
 * The worker decrypts rather than asking the API for the plaintext: shipping a secret
 * over an internal HTTP call would put it in a second process's logs and a second
 * process's memory for no benefit. Both sides use `CREDENTIALS_KEY` and the same
 * `v1:<iv>:<tag>:<ciphertext>` envelope.
 */

const PREFIX = 'v1';

export async function readSecret(prisma: PrismaClient, key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  const stored = row?.value;
  if (typeof stored !== 'string' || stored === '') return null;

  if (!stored.startsWith(`${PREFIX}:`)) return stored;

  try {
    return decrypt(stored, process.env.CREDENTIALS_KEY ?? '');
  } catch {
    // A rotated key leaves rows nothing can read. Reporting "not configured" makes the
    // adapter fall back to the log notifier rather than crashing every job.
    return null;
  }
}

function decrypt(stored: string, secret: string): string {
  const [, iv, tag, ciphertext] = stored.split(':') as [string, string, string, string];
  const decipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256').update(secret, 'utf8').digest(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
