import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

/**
 * A small read-through cache for catalogue responses — PRD Section 1.3 and M7.
 *
 * Two rules make this safe to put in front of a shop.
 *
 * **A cache miss is never an error.** If Redis is unreachable every call falls through
 * to the database. A shop whose cache dies should get slower, not broken.
 *
 * **Writes invalidate by prefix, immediately.** A price change that takes sixty seconds
 * to appear is a price change a customer can screenshot at the old value, so nothing
 * here waits for a TTL to expire. The TTL exists only to bound the damage from a miss
 * in the invalidation.
 */

/** Namespaces, so a write to one can clear exactly what it should. */
export const CACHE_PREFIX = {
  catalog: 'cache:catalog',
  collections: 'cache:collections',
  storefront: 'cache:storefront',
} as const;

export type CachePrefix = (typeof CACHE_PREFIX)[keyof typeof CACHE_PREFIX];

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: IORedis | null;
  /** Counted so `/metrics` can show whether the cache is earning its place. */
  private hits = 0;
  private misses = 0;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');

    this.redis = url
      ? new IORedis(url, {
          // One retry, then give up and read the database: a slow cache is worse than
          // no cache on a request a shopper is waiting for.
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: true,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
        })
      : null;

    this.redis?.on('error', (error) => {
      // Logged once per failure rather than thrown: every caller already falls back.
      this.logger.debug(`Cache unavailable: ${error.message}`);
    });

    void this.redis?.connect().catch(() => undefined);
  }

  /**
   * Reads through the cache, computing on a miss.
   *
   * Serialisation goes through the caller's own JSON, so a value holding a bigint has
   * to arrive already stringified — which is what every DTO in this codebase does.
   */
  async wrap<T>(prefix: CachePrefix, key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const full = `${prefix}:${key}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(full);
        if (cached !== null) {
          this.hits += 1;
          return JSON.parse(cached) as T;
        }
      } catch {
        // Fall through to the database.
      }
    }

    this.misses += 1;
    const value = await compute();

    if (this.redis) {
      try {
        await this.redis.set(full, JSON.stringify(value), 'EX', ttlSeconds);
      } catch {
        // A value that could not be cached is still a value.
      }
    }

    return value;
  }

  /**
   * Drops everything under a prefix.
   *
   * `SCAN` rather than `KEYS`: the latter blocks Redis for the length of the keyspace,
   * and a catalogue import would stall every other request while it ran.
   */
  async invalidate(prefix: CachePrefix): Promise<number> {
    if (!this.redis) return 0;

    let cursor = '0';
    let removed = 0;

    try {
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
          removed += keys.length;
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Could not invalidate ${prefix}: ${(error as Error).message}`);
    }

    return removed;
  }

  /** Clears every namespace. Used by the import and by a settings change. */
  async invalidateAll(): Promise<void> {
    for (const prefix of Object.values(CACHE_PREFIX)) {
      await this.invalidate(prefix);
    }
  }

  /** Hit rate, for `/metrics`. */
  stats(): { hits: number; misses: number; enabled: boolean } {
    return { hits: this.hits, misses: this.misses, enabled: this.redis !== null };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}

/**
 * A stable key from a query object.
 *
 * Sorted, so `?page=1&q=cap` and `?q=cap&page=1` are one cache entry rather than two
 * with the same answer.
 */
export function cacheKey(parts: Record<string, unknown>): string {
  return Object.entries(parts)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? [...value].sort().join('|') : String(value)}`)
    .join('&');
}
