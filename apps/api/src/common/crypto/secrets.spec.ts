import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncrypted } from './secrets.js';

const KEY = 'a-development-credentials-key-32b';

describe('secret encryption', () => {
  it('round-trips a value', () => {
    const stored = encryptSecret('yalidine-api-token-123', KEY);
    expect(decryptSecret(stored, KEY)).toBe('yalidine-api-token-123');
  });

  it('never stores the plaintext', () => {
    const stored = encryptSecret('super-secret', KEY);
    expect(stored).not.toContain('super-secret');
    expect(stored.startsWith('v1:')).toBe(true);
  });

  it('produces a different ciphertext each time', () => {
    // A fresh IV per call is what stops an observer learning that two providers share
    // the same key just by comparing two rows.
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('refuses a value encrypted under a different key', () => {
    const stored = encryptSecret('secret', KEY);
    expect(() => decryptSecret(stored, 'a-completely-different-key-value')).toThrow();
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    const stored = encryptSecret('secret', KEY);
    const parts = stored.split(':');
    const flipped = Buffer.from(parts[3]!, 'base64url');
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    parts[3] = flipped.toString('base64url');
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow();
  });

  it('rejects a malformed stored value with a clear message', () => {
    expect(() => decryptSecret('not-encrypted', KEY)).toThrow(/expected format/);
    expect(() => decryptSecret('v2:a:b:c', KEY)).toThrow(/expected format/);
  });

  it('handles unicode and empty strings', () => {
    for (const value of ['', 'مفتاح سري', 'clé-à-accent']) {
      expect(decryptSecret(encryptSecret(value, KEY), KEY)).toBe(value);
    }
  });

  it('recognises its own output', () => {
    expect(isEncrypted(encryptSecret('x', KEY))).toBe(true);
    expect(isEncrypted('plaintext')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(42)).toBe(false);
  });
});
