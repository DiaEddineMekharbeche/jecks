import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { STOREFRONT_CACHE_TAGS } from '@jecks/shared';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { CacheService } from './cache.service.js';
import { CacheInvalidationInterceptor, __cacheRules } from './cache-invalidation.interceptor.js';
import {
  REVALIDATION_FETCH,
  StorefrontRevalidationService,
} from './storefront-revalidation.service.js';

/**
 * Telling the storefront its cached pages are stale — PRD F-AD-10.
 *
 * The first test is the one that matters most. The service once took its `fetch` as a
 * defaulted constructor argument; every unit test built it by hand and passed, and the
 * API refused to boot, because Nest resolves every constructor parameter from the
 * container. Only resolving it through a real module catches that.
 */

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

/** Lets the fire-and-forget request settle before asserting on it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('StorefrontRevalidationService', () => {
  it('resolves from the Nest container without a fetch provider', async () => {
    const module = await Test.createTestingModule({
      providers: [
        StorefrontRevalidationService,
        { provide: ConfigService, useValue: config({ STOREFRONT_URL: 'http://shop' }) },
      ],
    }).compile();

    expect(module.get(StorefrontRevalidationService)).toBeInstanceOf(StorefrontRevalidationService);
  });

  it('posts the tags to the storefront with the shared token', async () => {
    const http = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const module = await Test.createTestingModule({
      providers: [
        StorefrontRevalidationService,
        {
          provide: ConfigService,
          useValue: config({ STOREFRONT_URL: 'http://shop:3200/', REVALIDATE_TOKEN: 'secret-1' }),
        },
        { provide: REVALIDATION_FETCH, useValue: http },
      ],
    }).compile();

    module.get(StorefrontRevalidationService).revalidate(['products', 'home']);
    await settle();

    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0]!;
    // A trailing slash on the configured URL must not produce `//api`.
    expect(url).toBe('http://shop:3200/api/revalidate');
    expect(init.method).toBe('POST');
    expect(init.headers['x-revalidate-token']).toBe('secret-1');
    expect(JSON.parse(init.body)).toEqual({ tags: ['products', 'home'] });
  });

  it('prefers the internal address, so a revalidation stays inside the deployment', async () => {
    const http = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new StorefrontRevalidationService(
      config({
        STOREFRONT_URL: 'https://jecks.dz',
        STOREFRONT_INTERNAL_URL: 'http://web:3000',
        REVALIDATE_TOKEN: 'secret-1',
      }),
      http,
    );

    service.revalidate(['products']);
    await settle();

    expect(http.mock.calls[0]![0]).toBe('http://web:3000/api/revalidate');
  });

  it('does nothing when no token is configured', async () => {
    const http = vi.fn();
    const service = new StorefrontRevalidationService(
      config({ STOREFRONT_URL: 'http://shop' }),
      http,
    );

    service.revalidate(['products']);
    await settle();

    expect(service.enabled).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it('does not send an empty batch', async () => {
    const http = vi.fn();
    const service = new StorefrontRevalidationService(
      config({ STOREFRONT_URL: 'http://shop', REVALIDATE_TOKEN: 'secret-1' }),
      http,
    );

    service.revalidate([]);
    await settle();

    expect(http).not.toHaveBeenCalled();
  });

  it('swallows an unreachable storefront, because the write already succeeded', async () => {
    const http = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new StorefrontRevalidationService(
      config({ STOREFRONT_URL: 'http://shop', REVALIDATE_TOKEN: 'secret-1' }),
      http,
    );

    expect(() => service.revalidate(['products'])).not.toThrow();
    await settle();
    expect(http).toHaveBeenCalledOnce();
  });
});

describe('invalidation rules', () => {
  async function tagsFor(method: string, path: string): Promise<string[] | null> {
    const cache = { invalidate: vi.fn().mockResolvedValue(0) } as unknown as CacheService;
    const revalidate = vi.fn();
    const interceptor = new CacheInvalidationInterceptor(cache, { revalidate } as never);

    const context = {
      switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
    } as never;
    await firstValueFrom(interceptor.intercept(context, { handle: () => of({}) } as never));

    return revalidate.mock.calls[0]?.[0] ?? null;
  }

  it('only ever names tags the storefront route accepts', () => {
    for (const rule of __cacheRules) {
      for (const tag of rule.tags) expect(STOREFRONT_CACHE_TAGS).toContain(tag);
    }
  });

  it.each([
    // Writes that change what a shopper sees, including the ones that used to slip past.
    ['PATCH', '/api/v1/admin/products/abc', 'products'],
    ['POST', '/api/v1/admin/collections/abc/merchandising', 'collections'],
    ['POST', '/api/v1/admin/reviews/moderate', 'reviews'],
    ['PATCH', '/api/v1/admin/brands/abc', 'products'],
    ['POST', '/api/v1/admin/tags', 'products'],
    ['POST', '/api/v1/admin/search-synonyms', 'products'],
    ['POST', '/api/v1/admin/purchase-orders/abc/receive', 'products'],
    ['POST', '/api/v1/admin/stock-counts/abc/apply', 'products'],
    ['PATCH', '/api/v1/admin/content/pages/abc', 'pages'],
    ['PATCH', '/api/v1/admin/settings/store', 'bootstrap'],
  ])('%s %s revalidates %s', async (method, path, tag) => {
    expect(await tagsFor(method, path)).toContain(tag);
  });

  it.each([
    ['POST', '/api/v1/admin/orders/abc/notes'],
    ['POST', '/api/v1/admin/users'],
    ['POST', '/api/v1/admin/finance/expenses'],
    // A prefix match must stop at a segment: "tagsomething" is not "tags".
    ['POST', '/api/v1/admin/tagsomething'],
  ])('%s %s leaves the storefront alone', async (method, path) => {
    expect(await tagsFor(method, path)).toBeNull();
  });
});
