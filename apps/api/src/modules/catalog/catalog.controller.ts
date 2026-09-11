import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { catalogQuerySchema, type CatalogQuery } from '@jecks/shared';
import { CACHE_PREFIX, CacheService, cacheKey } from '../../common/cache/cache.service.js';
import { Public } from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';

/**
 * How long a catalogue answer may be served from cache.
 *
 * Short, because a write invalidates immediately and the TTL only bounds the damage
 * from a missed invalidation. Sixty seconds of a stale grid is survivable; sixty
 * seconds of a stale price is not, which is why the product page is the shortest.
 */
const TTL = { grid: 60, product: 30, collections: 300, facets: 60, search: 30 } as const;

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly cache: CacheService,
  ) {}

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Filtered, sorted, paginated product grid' })
  listProducts(@Query(zod(catalogQuerySchema)) query: CatalogQuery) {
    return this.cache.wrap(CACHE_PREFIX.catalog, cacheKey({ ...query }), TTL.grid, () =>
      this.catalog.listProducts(query),
    );
  }

  @Public()
  @Get('products/:slug')
  @ApiOperation({ summary: 'One product with variants, media and attributes' })
  getProduct(@Param('slug') slug: string) {
    return this.cache.wrap(CACHE_PREFIX.catalog, `product:${slug}`, TTL.product, () =>
      this.catalog.getProduct(slug),
    );
  }

  @Public()
  @Get('collections')
  @ApiOperation({ summary: 'Published collections' })
  listCollections() {
    return this.cache.wrap(CACHE_PREFIX.collections, 'all', TTL.collections, () =>
      this.catalog.listCollections(),
    );
  }

  @Public()
  @Get('collections/:slug')
  @ApiOperation({ summary: 'One collection with its products' })
  getCollection(@Param('slug') slug: string, @Query(zod(catalogQuerySchema)) query: CatalogQuery) {
    return this.cache.wrap(
      CACHE_PREFIX.collections,
      cacheKey({ slug, ...query }),
      TTL.grid,
      () => this.catalog.getCollection(slug, query),
    );
  }

  @Public()
  @Get('facets')
  @ApiOperation({ summary: 'Facet counts for the filter rail' })
  facets(@Query(zod(catalogQuerySchema)) query: CatalogQuery) {
    return this.cache.wrap(CACHE_PREFIX.catalog, cacheKey({ facets: 1, ...query }), TTL.facets, () =>
      this.catalog.facets(query),
    );
  }

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Typo-tolerant instant search over products and collections' })
  search(@Query('q') q = '') {
    // Cached by the normalised term, so "Casquette" and "casquette " share an answer.
    return this.cache.wrap(CACHE_PREFIX.catalog, `search:${q.trim().toLowerCase()}`, TTL.search, () =>
      this.catalog.search(q),
    );
  }
}
