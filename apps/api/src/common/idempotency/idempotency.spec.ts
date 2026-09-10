import { ConflictException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { IdempotencyGuard, headerKey } from './idempotency.guard.js';

/**
 * The in-flight lock for idempotent writes.
 *
 * What matters is the failure behaviour: a cache that is down must not stop a shop
 * taking orders, and two simultaneous requests with one key must not both proceed.
 */

function context(options: {
  headers?: Record<string, string | string[] | undefined>;
  path?: string;
}): ExecutionContext {
  const listeners: Record<string, Array<() => void>> = {};

  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: options.headers ?? {}, path: options.path ?? '/orders' }),
      getResponse: () => ({
        on: (event: string, callback: () => void) => {
          (listeners[event] ??= []).push(callback);
        },
        listeners,
      }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function guard(options: {
  required?: boolean;
  redisUrl?: string | null;
  set?: ReturnType<typeof vi.fn>;
  del?: ReturnType<typeof vi.fn>;
}): IdempotencyGuard {
  const reflector = {
    getAllAndOverride: () => options.required ?? true,
  } as never;

  const config = {
    get: () => options.redisUrl === undefined ? 'redis://localhost:6379' : options.redisUrl,
  } as never;

  const instance = new IdempotencyGuard(reflector, config);

  // The constructor builds a lazily-connecting client; swap it for a double rather than
  // opening a socket in a unit test.
  Reflect.set(instance, 'redis', options.redisUrl === null
    ? null
    : {
        set: options.set ?? vi.fn(async () => 'OK'),
        del: options.del ?? vi.fn(async () => 1),
        on: () => undefined,
      });

  return instance;
}

describe('headerKey', () => {
  it('reads the header case-insensitively', () => {
    expect(headerKey({ headers: { 'idempotency-key': 'abc' } })).toBe('abc');
    expect(headerKey({ headers: { 'Idempotency-Key': 'abc' } })).toBe('abc');
  });

  it('takes the first value when the header repeats', () => {
    expect(headerKey({ headers: { 'idempotency-key': ['first', 'second'] } })).toBe('first');
  });

  it('is null when the header is absent or blank', () => {
    expect(headerKey({ headers: {} })).toBeNull();
    expect(headerKey({ headers: { 'idempotency-key': '   ' } })).toBeNull();
  });

  it('caps a huge value so it cannot be used as an unbounded cache key', () => {
    expect(headerKey({ headers: { 'idempotency-key': 'x'.repeat(500) } })).toHaveLength(128);
  });
});

describe('IdempotencyGuard', () => {
  it('passes through a route that is not marked idempotent', async () => {
    const set = vi.fn();
    const instance = guard({ required: false, set });

    expect(await instance.canActivate(context({ headers: { 'idempotency-key': 'k' } }))).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('passes through a request that sent no key', async () => {
    const set = vi.fn();
    const instance = guard({ set });

    expect(await instance.canActivate(context({}))).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('takes the lock for the first request', async () => {
    const set = vi.fn(async () => 'OK');
    const instance = guard({ set });

    expect(
      await instance.canActivate(context({ headers: { 'idempotency-key': 'k' } })),
    ).toBe(true);
    expect(set).toHaveBeenCalledOnce();
  });

  it('refuses a second request while the first is still running', async () => {
    // `SET NX` returning null means the key was already there.
    const instance = guard({ set: vi.fn(async () => null) });

    await expect(
      instance.canActivate(context({ headers: { 'idempotency-key': 'k' } })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keys the lock on the path as well as the header', async () => {
    const set = vi.fn(async () => 'OK');
    const instance = guard({ set });

    await instance.canActivate(context({ headers: { 'idempotency-key': 'k' }, path: '/orders' }));
    await instance.canActivate(
      context({ headers: { 'idempotency-key': 'k' }, path: '/webhooks/couriers/yalidine' }),
    );

    const first = (set.mock.calls[0] as unknown[])[0] as string;
    const second = (set.mock.calls[1] as unknown[])[0] as string;
    expect(first).not.toBe(second);
  });

  it('lets the request through when the store is unreachable', async () => {
    // A shop must keep taking orders when a cache is down; the unique column on
    // Order.idempotencyKey is what actually prevents a duplicate.
    const instance = guard({
      set: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });

    expect(
      await instance.canActivate(context({ headers: { 'idempotency-key': 'k' } })),
    ).toBe(true);
  });

  it('lets the request through when no store is configured at all', async () => {
    const instance = guard({ redisUrl: null });
    expect(
      await instance.canActivate(context({ headers: { 'idempotency-key': 'k' } })),
    ).toBe(true);
  });

  it('releases the lock when the response finishes, so a retry is immediate', async () => {
    const del = vi.fn(async () => 1);
    const instance = guard({ del });

    const ctx = context({ headers: { 'idempotency-key': 'k' } });
    await instance.canActivate(ctx);

    const response = ctx.switchToHttp().getResponse<{ listeners: Record<string, Array<() => void>> }>();
    for (const callback of response.listeners.finish ?? []) callback();

    expect(del).toHaveBeenCalledOnce();
  });
});
