import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../../common/cache/cache.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  LogErrorReporter,
  SentryErrorReporter,
  parseDsn,
  parseStack,
  type ReporterHttpClient,
} from './error-reporter.js';
import { MetricsService, escapeLabel } from './metrics.service.js';

/**
 * The operations surface.
 *
 * Two properties matter more than the rest: a metrics endpoint must not grow a series
 * per order id, and an error reporter must never turn one incident into two.
 */

function makeMetrics(): MetricsService {
  const prisma = {
    order: { count: vi.fn().mockResolvedValue(3) },
    product: { count: vi.fn().mockResolvedValue(1) },
  } as unknown as PrismaService;

  const cache = {
    stats: () => ({ hits: 7, misses: 3, enabled: true }),
  } as unknown as CacheService;

  return new MetricsService(prisma, cache);
}

describe('MetricsService', () => {
  it('renders the exposition format a scrape expects', async () => {
    const text = await makeMetrics().render();

    expect(text).toContain('# TYPE jecks_up gauge');
    expect(text).toContain('jecks_up 1');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('counts requests by method, route and status class', async () => {
    const metrics = makeMetrics();
    metrics.record({ method: 'GET', route: '/catalog/products', status: 200, durationMs: 12 });
    metrics.record({ method: 'GET', route: '/catalog/products', status: 204, durationMs: 8 });

    const text = await metrics.render();
    expect(text).toContain(
      'jecks_http_requests_total{method="GET",route="/catalog/products",status="2xx"} 2',
    );
  });

  it('keeps status classes apart', async () => {
    const metrics = makeMetrics();
    metrics.record({ method: 'GET', route: '/orders/:id', status: 200, durationMs: 5 });
    metrics.record({ method: 'GET', route: '/orders/:id', status: 404, durationMs: 5 });

    const text = await metrics.render();
    expect(text).toContain('status="2xx"} 1');
    expect(text).toContain('status="4xx"} 1');
  });

  it('fills the latency histogram cumulatively', async () => {
    const metrics = makeMetrics();
    metrics.record({ method: 'GET', route: '/x', status: 200, durationMs: 40 });
    metrics.record({ method: 'GET', route: '/x', status: 200, durationMs: 300 });

    const text = await metrics.render();
    // One request under 50 ms, both under 500 ms.
    expect(text).toContain('jecks_http_request_duration_ms_bucket{le="50"} 1');
    expect(text).toContain('jecks_http_request_duration_ms_bucket{le="500"} 2');
    expect(text).toContain('jecks_http_request_duration_ms_count 2');
  });

  it('reports the cache hit and miss counters', async () => {
    const text = await makeMetrics().render();
    expect(text).toContain('jecks_cache_hits_total 7');
    expect(text).toContain('jecks_cache_misses_total 3');
    expect(text).toContain('jecks_cache_enabled 1');
  });

  it('includes the gauges somebody would be woken up for', async () => {
    const text = await makeMetrics().render();
    expect(text).toContain('jecks_orders_pending 3');
    expect(text).toContain('jecks_orders_unshipped_over_24h 3');
    expect(text).toContain('jecks_products_out_of_stock 1');
  });

  it('escapes label values that would break the format', () => {
    expect(escapeLabel('a"b')).toBe('a\\"b');
    expect(escapeLabel('a\\b')).toBe('a\\\\b');
    expect(escapeLabel('a\nb')).toBe('a\\nb');
  });
});

describe('parseDsn', () => {
  it('splits a Sentry DSN into its parts', () => {
    const dsn = parseDsn('https://abc123@o1.ingest.sentry.io/42');
    expect(dsn).toEqual({
      protocol: 'https',
      publicKey: 'abc123',
      host: 'o1.ingest.sentry.io',
      projectId: '42',
    });
  });

  it('keeps only the public half of a legacy key pair', () => {
    expect(parseDsn('https://public:secret@o1.ingest.sentry.io/42')?.publicKey).toBe('public');
  });

  it('returns null for anything unparseable, rather than stopping the boot', () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('not-a-dsn')).toBeNull();
    expect(parseDsn('https://o1.ingest.sentry.io/42')).toBeNull();
  });
});

describe('parseStack', () => {
  it('reads frames out of a Node stack', () => {
    const stack = [
      'Error: boom',
      '    at doThing (/app/src/thing.ts:10:5)',
      '    at /app/node_modules/express/lib/router.js:3:1',
    ].join('\n');

    const frames = parseStack(stack);
    // Sentry wants the innermost frame last.
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ function: 'doThing', lineno: 10, in_app: true });
    expect(frames[0]).toMatchObject({ in_app: false });
  });

  it('returns nothing for a missing stack', () => {
    expect(parseStack(undefined)).toEqual([]);
  });
});

describe('error reporters', () => {
  const config = (dsn?: string) =>
    ({ get: vi.fn((key: string) => (key === 'SENTRY_DSN' ? dsn : undefined)) }) as unknown as ConfigService;

  it('the log reporter always accepts an error', async () => {
    await expect(new LogErrorReporter().capture(new Error('boom'))).resolves.toBeUndefined();
  });

  it('Sentry reports itself unconfigured without a DSN', () => {
    expect(new SentryErrorReporter(config()).configured).toBe(false);
  });

  it('sends nothing when there is no DSN', async () => {
    const http = vi.fn() as unknown as ReporterHttpClient;
    await new SentryErrorReporter(config(), http).capture(new Error('boom'));
    expect(http).not.toHaveBeenCalled();
  });

  it('posts to the store endpoint with the auth header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const http = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    }) as unknown as ReporterHttpClient;

    await new SentryErrorReporter(config('https://key@o1.ingest.sentry.io/42'), http).capture(
      new Error('boom'),
      { correlationId: 'abc', route: '/orders' },
    );

    expect(calls[0]!.url).toBe('https://o1.ingest.sentry.io/api/42/store/');
    expect((calls[0]!.init.headers as Record<string, string>)['x-sentry-auth']).toContain(
      'sentry_key=key',
    );

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      transaction: string;
      tags: Record<string, string>;
      exception: { values: Array<{ value: string }> };
    };
    expect(body.transaction).toBe('/orders');
    expect(body.tags.correlation_id).toBe('abc');
    expect(body.exception.values[0]!.value).toBe('boom');
  });

  it('swallows a transport failure rather than raising a second error', async () => {
    const http = (async () => {
      throw new Error('network down');
    }) as unknown as ReporterHttpClient;

    await expect(
      new SentryErrorReporter(config('https://key@o1.ingest.sentry.io/42'), http).capture(
        new Error('boom'),
      ),
    ).resolves.toBeUndefined();
  });

  it('swallows a rejection from Sentry itself', async () => {
    const http = (async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })) as unknown as ReporterHttpClient;

    await expect(
      new SentryErrorReporter(config('https://key@o1.ingest.sentry.io/42'), http).capture(
        new Error('boom'),
      ),
    ).resolves.toBeUndefined();
  });
});
