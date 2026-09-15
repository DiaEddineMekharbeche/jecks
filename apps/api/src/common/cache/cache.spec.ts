import type { ConfigService } from '@nestjs/config';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CACHE_PREFIX, CacheService, cacheKey } from './cache.service.js';
import { CacheInvalidationInterceptor } from './cache-invalidation.interceptor.js';

/**
 * The cache, with Redis absent.
 *
 * That is the case worth testing hardest: a shop whose cache is down has to keep
 * selling, so every path has to fall through to the database rather than fail.
 */

function makeCache(): CacheService {
  const config = { get: vi.fn(() => undefined) } as unknown as ConfigService;
  return new CacheService(config);
}

describe('cacheKey', () => {
  it('sorts, so argument order cannot split one answer into two entries', () => {
    expect(cacheKey({ page: 1, q: 'cap' })).toBe(cacheKey({ q: 'cap', page: 1 }));
  });

  it('drops empty values rather than keying on them', () => {
    expect(cacheKey({ q: '', page: 2 })).toBe('page=2');
    expect(cacheKey({ q: undefined, page: 2 })).toBe('page=2');
    expect(cacheKey({ q: null, page: 2 })).toBe('page=2');
  });

  it('sorts array values too', () => {
    expect(cacheKey({ tags: ['b', 'a'] })).toBe(cacheKey({ tags: ['a', 'b'] }));
  });

  it('distinguishes genuinely different queries', () => {
    expect(cacheKey({ page: 1 })).not.toBe(cacheKey({ page: 2 }));
  });

  it('is empty for an empty query', () => {
    expect(cacheKey({})).toBe('');
  });
});

describe('CacheService without Redis', () => {
  it('computes the value rather than failing', async () => {
    const cache = makeCache();
    const value = await cache.wrap(CACHE_PREFIX.catalog, 'k', 60, async () => ({ ok: true }));
    expect(value).toEqual({ ok: true });
  });

  it('computes every time, because nothing is stored', async () => {
    const cache = makeCache();
    const compute = vi.fn().mockResolvedValue(1);

    await cache.wrap(CACHE_PREFIX.catalog, 'k', 60, compute);
    await cache.wrap(CACHE_PREFIX.catalog, 'k', 60, compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('reports itself as disabled, so metrics do not claim a 0 % hit rate', async () => {
    const cache = makeCache();
    await cache.wrap(CACHE_PREFIX.catalog, 'k', 60, async () => 1);

    expect(cache.stats().enabled).toBe(false);
    expect(cache.stats().misses).toBe(1);
  });

  it('invalidates to zero rather than throwing', async () => {
    const cache = makeCache();
    expect(await cache.invalidate(CACHE_PREFIX.catalog)).toBe(0);
    await expect(cache.invalidateAll()).resolves.toBeUndefined();
  });

  it('lets a computation error through untouched', async () => {
    const cache = makeCache();
    await expect(
      cache.wrap(CACHE_PREFIX.catalog, 'k', 60, async () => {
        throw new Error('database down');
      }),
    ).rejects.toThrow('database down');
  });
});

describe('CacheInvalidationInterceptor', () => {
  /** Runs the interceptor over a real observable and waits for it to complete. */
  async function run(method: string, path: string) {
    const invalidate = vi.fn().mockResolvedValue(0);
    const cache = { invalidate } as unknown as CacheService;
    // The storefront has its own cache in its own process; the interceptor tells it too.
    const revalidate = vi.fn();
    const storefront = { revalidate, enabled: true } as never;
    const interceptor = new CacheInvalidationInterceptor(cache, storefront);

    const context = {
      switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
    } as never;

    const handler = { handle: () => of({ ok: true }) } as never;

    await firstValueFrom(interceptor.intercept(context, handler));
    // The invalidation is fired without being awaited, so let the microtasks drain.
    await Promise.resolve();

    return { invalidate, revalidate };
  }

  it('ignores reads', async () => {
    const { invalidate } = await run('GET', '/api/v1/admin/catalog/products');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores a write to a route that changes nothing a shopper sees', async () => {
    const { invalidate } = await run('POST', '/api/v1/admin/orders/x/notes');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('clears the catalogue after a product write', async () => {
    const { invalidate } = await run('PATCH', '/api/v1/admin/catalog/products/x');
    expect(invalidate).toHaveBeenCalledWith(CACHE_PREFIX.catalog);
    expect(invalidate).toHaveBeenCalledWith(CACHE_PREFIX.collections);
  });

  it('clears the catalogue after a stock movement, because availability is shown', async () => {
    const { invalidate } = await run('POST', '/api/v1/admin/inventory/adjust');
    expect(invalidate).toHaveBeenCalledWith(CACHE_PREFIX.catalog);
  });

  it('clears first-paint content after a settings change', async () => {
    const { invalidate } = await run('PATCH', '/api/v1/admin/settings/theme');
    expect(invalidate).toHaveBeenCalledWith(CACHE_PREFIX.storefront);
  });

  it('clears the grid after a promotion changes, because it shows the price', async () => {
    const { invalidate } = await run('POST', '/api/v1/admin/promotions');
    expect(invalidate).toHaveBeenCalledWith(CACHE_PREFIX.catalog);
  });

  it('leaves the cache alone when the write fails', async () => {
    const invalidate = vi.fn().mockResolvedValue(0);
    const cache = { invalidate } as unknown as CacheService;
    // The storefront has its own cache in its own process; the interceptor tells it too.
    const revalidate = vi.fn();
    const storefront = { revalidate, enabled: true } as never;
    const interceptor = new CacheInvalidationInterceptor(cache, storefront);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/api/v1/admin/catalog/products' }),
      }),
    } as never;
    const handler = { handle: () => throwError(() => new Error('rejected')) } as never;

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toThrow(
      'rejected',
    );
    await Promise.resolve();

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tells the storefront which of its tags went stale', async () => {
    // Clearing the API's own Redis cache does nothing for the page a shopper loads: the
    // storefront is a separate process holding rendered pages for minutes.
    const { revalidate } = await run('POST', '/api/v1/admin/products');

    expect(revalidate).toHaveBeenCalledOnce();
    expect(revalidate.mock.calls[0]![0]).toContain('products');
  });

  it('names the home page when content or settings change', async () => {
    const { revalidate } = await run('PATCH', '/api/v1/admin/content/home/abc');

    expect(revalidate.mock.calls[0]![0]).toContain('home');
  });

  it('does not touch the storefront for a read', async () => {
    const { revalidate } = await run('GET', '/api/v1/admin/products');

    expect(revalidate).not.toHaveBeenCalled();
  });

  it('does not touch it for a route that changes nothing a shopper sees', async () => {
    const { revalidate } = await run('POST', '/api/v1/admin/users');

    expect(revalidate).not.toHaveBeenCalled();
  });
});
