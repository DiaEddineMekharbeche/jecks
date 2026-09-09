import { describe, expect, it } from 'vitest';
import { __auditInternals } from './audit.interceptor.js';

const { redact, entityFromUrl, routePattern, extractId } = __auditInternals;

describe('redact', () => {
  it('replaces secret values while keeping the field visible', () => {
    expect(redact({ email: 'a@b.dz', password: 'hunter2' })).toEqual({
      email: 'a@b.dz',
      password: '[redacted]',
    });
  });

  it('matches secret keys regardless of case', () => {
    expect(redact({ TwoFactorSecret: 'x', APIKEY: 'y', valueEnc: 'z' })).toEqual({
      TwoFactorSecret: '[redacted]',
      APIKEY: '[redacted]',
      valueEnc: '[redacted]',
    });
  });

  it('redacts nested secrets', () => {
    expect(redact({ courier: { name: 'Yalidine', credentials: { token: 'abc' } } })).toEqual({
      courier: { name: 'Yalidine', credentials: '[redacted]' },
    });
  });

  it('renders BigInt money as a string, because JSON cannot hold it', () => {
    expect(redact({ price: 350000n })).toEqual({ price: '350000' });
  });

  it('keeps arrays but caps them, so a bulk edit cannot bloat the log', () => {
    const long = Array.from({ length: 250 }, (_, index) => index);
    expect((redact(long) as number[]).length).toBe(100);
  });

  it('truncates a very long string', () => {
    const body = 'x'.repeat(5000);
    expect(redact({ body })).toEqual({ body: `${'x'.repeat(2000)}…` });
  });

  it('stops recursing on deeply nested input rather than overflowing', () => {
    let nested: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 20; i += 1) nested = { child: nested };
    expect(() => redact(nested)).not.toThrow();
  });

  it('passes primitives and null through', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeNull();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });
});

describe('entityFromUrl', () => {
  it.each([
    ['/api/v1/admin/products/abc', 'product'],
    ['/api/v1/admin/orders', 'order'],
    ['/api/v1/admin/purchase-orders/1', 'purchase-order'],
    ['/api/v1/admin/settings', 'setting'],
  ])('derives %s -> %s', (url, expected) => {
    expect(entityFromUrl(url)).toBe(expected);
  });

  it('falls back when the URL is not an admin route', () => {
    expect(entityFromUrl('/api/v1/catalog/products')).toBe('unknown');
    expect(entityFromUrl()).toBe('unknown');
  });
});

describe('routePattern', () => {
  it('collapses a uuid so actions group across records', () => {
    expect(routePattern('/api/v1/admin/orders/01a08612-8c7a-7e60-a56a-19bd9f231e32/transition')).toBe(
      '/api/v1/admin/orders/:id/transition',
    );
  });

  it('collapses numeric segments', () => {
    expect(routePattern('/api/v1/admin/shipping/wilayas/16/rates')).toBe(
      '/api/v1/admin/shipping/wilayas/:n/rates',
    );
  });

  it('drops the query string', () => {
    expect(routePattern('/api/v1/admin/products?page=2')).toBe('/api/v1/admin/products');
  });
});

describe('extractId', () => {
  it('reads the id off a returned entity', () => {
    expect(extractId({ id: 'abc' })).toBe('abc');
  });

  it('reads it out of an envelope', () => {
    expect(extractId({ data: { id: 'abc' } })).toBe('abc');
  });

  it('returns null when there is nothing to read', () => {
    expect(extractId(null)).toBeNull();
    expect(extractId('done')).toBeNull();
    expect(extractId({ count: 3 })).toBeNull();
  });
});
