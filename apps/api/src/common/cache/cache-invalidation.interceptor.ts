import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { StorefrontCacheTag } from '@jecks/shared';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { CACHE_PREFIX, CacheService, type CachePrefix } from './cache.service.js';
import { StorefrontRevalidationService } from './storefront-revalidation.service.js';

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

/**
 * Which Redis namespaces, and which storefront cache tags, a path prefix invalidates.
 *
 * The tags must match what the storefront fetches with (`next: { tags }`) and what its
 * `/api/revalidate` route accepts. A write whose route matches no rule clears nothing,
 * so a new shopper-visible admin route needs a line here or its changes lag by minutes.
 */
const RULES: Array<{ match: RegExp; prefixes: CachePrefix[]; tags: StorefrontCacheTag[] }> = [
  {
    // Products, variants, categories, collections, media and merchandising.
    match: /^\/api\/v1\/admin\/(catalog|products|variants|categories|collections|media)(\/|$)/,
    prefixes: [CACHE_PREFIX.catalog, CACHE_PREFIX.collections, CACHE_PREFIX.storefront],
    tags: ['products', 'collections', 'home', 'sitemap'],
  },
  {
    // Brands, tags, attributes and size guides are printed on product pages and drive
    // the filter rail; synonyms change what search returns.
    match: /^\/api\/v1\/admin\/(brands|tags|attributes|size-guides|search-synonyms)(\/|$)/,
    prefixes: [CACHE_PREFIX.catalog, CACHE_PREFIX.collections],
    tags: ['products', 'collections'],
  },
  {
    // Moderation moves the star rating on cards and the review blocks on the home page.
    match: /^\/api\/v1\/admin\/reviews(\/|$)/,
    prefixes: [CACHE_PREFIX.catalog, CACHE_PREFIX.storefront],
    tags: ['products', 'reviews', 'home'],
  },
  {
    // A price schedule or a promotion changes what the grid shows as the price.
    match: /^\/api\/v1\/admin\/promotions(\/|$)/,
    prefixes: [CACHE_PREFIX.catalog, CACHE_PREFIX.collections],
    tags: ['products', 'collections'],
  },
  {
    // Stock decides whether a product reads as available, and it moves through
    // adjustments, purchase receipts, applied counts and deactivated locations alike.
    match: /^\/api\/v1\/admin\/(inventory|purchase-orders|stock-counts|locations)(\/|$)/,
    prefixes: [CACHE_PREFIX.catalog],
    tags: ['products'],
  },
  {
    // The home page, menus, banners, pages and settings are all first-paint content.
    match: /^\/api\/v1\/admin\/(content|settings)(\/|$)/,
    prefixes: [CACHE_PREFIX.storefront, CACHE_PREFIX.collections],
    tags: ['home', 'bootstrap', 'collections', 'pages'],
  },
];

/** Exposed for the spec, which checks every rule against real admin routes. */
export const __cacheRules = RULES;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CacheInvalidationInterceptor implements NestInterceptor {
  constructor(
    private readonly cache: CacheService,
    private readonly storefront: StorefrontRevalidationService,
  ) {}

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
          // The storefront is a separate process with its own cache; clearing ours does
          // nothing for the page a shopper loads.
          this.storefront.revalidate(rule.tags);
        },
      }),
    );
  }
}
