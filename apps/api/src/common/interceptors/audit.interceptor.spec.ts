import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuditInterceptor, __auditInternals } from './audit.interceptor.js';

const { redact, entityFromUrl, routePattern, extractId } = __auditInternals;

/** Drives the interceptor with a request shape and returns what it would have logged. */
async function run(options: {
  method?: string;
  url?: string;
  body?: unknown;
  result?: unknown;
  skip?: boolean;
  entity?: string;
  user?: { id: string; name: string; email: string | null } | undefined;
}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    auditLog: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({});
      }),
    },
  } as unknown as PrismaService;

  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key.includes('auditSkip') ? (options.skip ?? false) : options.entity,
    ),
  } as unknown as Reflector;

  const request = {
    method: options.method ?? 'POST',
    originalUrl: options.url ?? '/api/v1/admin/products',
    body: options.body ?? {},
    params: {},
    headers: { 'user-agent': 'vitest' },
    ip: '10.0.0.1',
    user: options.user,
  };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  const handler: CallHandler = { handle: () => of(options.result ?? { id: 'abc' }) };

  await firstValueFrom(new AuditInterceptor(reflector, prisma).intercept(context, handler));
  // The write is fire-and-forget, so let the microtask queue drain.
  await new Promise((done) => setImmediate(done));

  return created;
}

describe('AuditInterceptor', () => {
  it('logs a mutating admin request', async () => {
    const rows = await run({
      method: 'POST',
      user: { id: 'user-1', name: 'Maher', email: 'owner@jecks.dz' },
      body: { name: 'Trucker Atlas' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: 'user-1',
      actorLabel: 'Maher <owner@jecks.dz>',
      action: 'POST /api/v1/admin/products',
      entityType: 'product',
      entityId: 'abc',
      ip: '10.0.0.1',
    });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('ignores %s, or the log fills with reads', async (method) => {
    expect(await run({ method })).toHaveLength(0);
  });

  it('ignores a mutation outside /admin, such as placing an order', async () => {
    expect(await run({ method: 'POST', url: '/api/v1/orders' })).toHaveLength(0);
  });

  it('honours @NoAudit on routes that are personal preference, not business change', async () => {
    expect(await run({ skip: true })).toHaveLength(0);
  });

  it('uses the entity name a controller declares', async () => {
    const rows = await run({ entity: 'media', url: '/api/v1/admin/media' });
    expect(rows[0]?.entityType).toBe('media');
  });

  it('labels an unauthenticated caller as system rather than dropping the row', async () => {
    const rows = await run({ user: undefined });
    expect(rows[0]).toMatchObject({ actorId: null, actorLabel: 'system' });
  });

  it('redacts secrets out of the recorded payload', async () => {
    const rows = await run({ body: { email: 'a@b.dz', password: 'hunter2' } });
    expect(rows[0]?.changes).toEqual({ email: 'a@b.dz', password: '[redacted]' });
  });

  it('does not fail the request when the audit write itself fails', async () => {
    // A logging failure must never roll back the change that caused it.
    const prisma = {
      auditLog: { create: vi.fn().mockRejectedValue(new Error('database down')) },
    } as unknown as PrismaService;
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/v1/admin/products',
          body: {},
          params: {},
          headers: {},
        }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    await expect(
      firstValueFrom(
        new AuditInterceptor(reflector, prisma).intercept(context, { handle: () => of('ok') }),
      ),
    ).resolves.toBe('ok');
  });
});

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
