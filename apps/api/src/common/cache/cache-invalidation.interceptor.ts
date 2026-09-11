import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { CACHE_PREFIX, CacheService, type CachePrefix } from './cache.service.js';

/**
 * Clears the read cache after any write that could change what a shopper sees.
 *
 * An interceptor rather than a call in each service, for two reasons. Eight services
 * write to the catalogue today and more will tomorrow; one of them will forget. And the
 * rule is about the *route*, not the row: anything under `/admin/catalog` changes the
 * catalogue by definition.
 *
 * Invalidation is deliberately coarse — the whole namespace, not one key. Working out
 * which of a hundred cached grids contained a given product costs more than recomputing
 * them, and being wrong means showing a price that no longer exists.
 */

/** Which namespaces a path prefix invalidates. */
const RULES: Array<{ match: RegExp; prefixes: CachePrefix[] }> = [
  {
    // Products, variants, categories, collections, media, merchandising, reviews.
    match: /^\/api\/v1\/admin\/(catalog|products|variants|categories|collections|media)/,
    prefixes: [CACHE_PREFIX.catalog, CACHE_PREFIX.collections, CACHE_PREFIX.storefront],
  },
  {
    // A price schedule or a promotion changes what the grid shows as the price.
    match: /^\/api\/v1\/admin\/promotions/,
    prefixes: [CACHE_PREFIX.catalog, CACHE_PREFIX.collections],
  },
  {
    // Stock decides whether a product reads as available.
    match: /^\/api\/v1\/admin\/inventory/,
    prefixes: [CACHE_PREFIX.catalog],
  },
  {
    // The home page, menus, banners and settings are all first-paint content.
    match: /^\/api\/v1\/admin\/(content|settings)/,
    prefixes: [CACHE_PREFIX.storefront, CACHE_PREFIX.collections],
  },
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CacheInvalidationInterceptor implements NestInterceptor {
  constructor(private readonly cache: CacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!WRITE_METHODS.has(request.method)) return next.handle();

    const rule = RULES.find((entry) => entry.match.test(request.path));
    if (!rule) return next.handle();

    return next.handle().pipe(
      tap({
        // Only on success: a rejected write changed nothing, and clearing the cache for
        // it would turn a validation error into a burst of database load.
        next: () => {
          void Promise.all(rule.prefixes.map((prefix) => this.cache.invalidate(prefix)));
        },
      }),
    );
  }
}
