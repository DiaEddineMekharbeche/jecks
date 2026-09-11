import { Injectable } from '@nestjs/common';
import { CacheService } from '../../common/cache/cache.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Prometheus metrics — PRD Section 10.5.
 *
 * Written by hand rather than through a client library, for the same reason the mailer
 * speaks ESMTP directly: the exposition format is a stable, documented text format, and
 * this is forty lines of it.
 *
 * The counters are process-local and reset on restart, which is exactly what Prometheus
 * expects of a counter. The gauges are read from the database on scrape: a shop's order
 * backlog is not something to keep a copy of.
 */

interface RequestSample {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, { count: number; totalMs: number }>();
  /** Latency buckets in milliseconds, matching the PRD's p95 targets. */
  private readonly buckets = [50, 100, 200, 500, 1000, 2000, 5000];
  private readonly histogram = new Map<number, number>();
  private total = 0;
  private totalMs = 0;
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    for (const bucket of this.buckets) this.histogram.set(bucket, 0);
  }

  /** Called by the correlation interceptor once a response is finished. */
  record(sample: RequestSample): void {
    // Keyed by route template, not by path: `/orders/:id` is one series, not one per
    // order, and a cardinality explosion is how a metrics endpoint takes down a server.
    const key = `${sample.method}|${sample.route}|${statusClass(sample.status)}`;
    const entry = this.requests.get(key) ?? { count: 0, totalMs: 0 };
    entry.count += 1;
    entry.totalMs += sample.durationMs;
    this.requests.set(key, entry);

    this.total += 1;
    this.totalMs += sample.durationMs;

    for (const bucket of this.buckets) {
      if (sample.durationMs <= bucket) {
        this.histogram.set(bucket, (this.histogram.get(bucket) ?? 0) + 1);
      }
    }
  }

  /** The exposition text a Prometheus scrape expects. */
  async render(): Promise<string> {
    const lines: string[] = [];

    lines.push('# HELP jecks_up Whether the API is answering.');
    lines.push('# TYPE jecks_up gauge');
    lines.push('jecks_up 1');

    lines.push('# HELP jecks_uptime_seconds Seconds since the process started.');
    lines.push('# TYPE jecks_uptime_seconds gauge');
    lines.push(`jecks_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`);

    lines.push('# HELP jecks_http_requests_total Requests handled, by method, route and status class.');
    lines.push('# TYPE jecks_http_requests_total counter');
    for (const [key, entry] of this.requests) {
      const [method, route, status] = key.split('|');
      lines.push(
        `jecks_http_requests_total{method="${method}",route="${escapeLabel(route ?? '')}",status="${status}"} ${entry.count}`,
      );
    }

    lines.push('# HELP jecks_http_request_duration_ms Request latency.');
    lines.push('# TYPE jecks_http_request_duration_ms histogram');
    for (const bucket of this.buckets) {
      lines.push(`jecks_http_request_duration_ms_bucket{le="${bucket}"} ${this.histogram.get(bucket) ?? 0}`);
    }
    lines.push(`jecks_http_request_duration_ms_bucket{le="+Inf"} ${this.total}`);
    lines.push(`jecks_http_request_duration_ms_sum ${Math.round(this.totalMs)}`);
    lines.push(`jecks_http_request_duration_ms_count ${this.total}`);

    const cache = this.cache.stats();
    lines.push('# HELP jecks_cache_hits_total Catalogue cache hits.');
    lines.push('# TYPE jecks_cache_hits_total counter');
    lines.push(`jecks_cache_hits_total ${cache.hits}`);
    lines.push('# HELP jecks_cache_misses_total Catalogue cache misses.');
    lines.push('# TYPE jecks_cache_misses_total counter');
    lines.push(`jecks_cache_misses_total ${cache.misses}`);
    lines.push('# HELP jecks_cache_enabled Whether Redis is reachable.');
    lines.push('# TYPE jecks_cache_enabled gauge');
    lines.push(`jecks_cache_enabled ${cache.enabled ? 1 : 0}`);

    // --- business gauges -----------------------------------------------------
    // The numbers somebody would be woken up for, rather than the ones that look good
    // on a dashboard.
    const business = await this.business();
    for (const [name, help, value] of business) {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }

    return `${lines.join('\n')}\n`;
  }

  private async business(): Promise<Array<[string, string, number]>> {
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [pending, failedDeliveries, unshipped, staleStock, ordersToday] = await Promise.all([
      this.prisma.order.count({ where: { status: 'PENDING', deletedAt: null } }),
      this.prisma.order.count({ where: { status: 'FAILED', deletedAt: null } }),
      this.prisma.order.count({
        where: { status: { in: ['CONFIRMED', 'PACKED'] }, deletedAt: null, createdAt: { lt: dayAgo } },
      }),
      this.prisma.product.count({ where: { status: 'ACTIVE', totalStock: { lte: 0 } } }),
      this.prisma.order.count({ where: { deletedAt: null, createdAt: { gte: dayAgo } } }),
    ]);

    return [
      ['jecks_orders_pending', 'Orders waiting for a confirmation call.', pending],
      ['jecks_orders_failed', 'Orders whose delivery failed and are not resolved.', failedDeliveries],
      [
        'jecks_orders_unshipped_over_24h',
        'Confirmed or packed orders older than a day that have not shipped.',
        unshipped,
      ],
      ['jecks_products_out_of_stock', 'Active products with no stock at all.', staleStock],
      ['jecks_orders_last_24h', 'Orders placed in the last day.', ordersToday],
    ];
  }
}

/** 2xx, 4xx, 5xx — three series instead of sixty. */
function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/** Prometheus label values escape backslash, quote and newline. */
export function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
