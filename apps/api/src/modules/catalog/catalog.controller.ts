import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { catalogQuerySchema, type CatalogQuery } from '@jecks/shared';
import { Public } from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Filtered, sorted, paginated product grid' })
  listProducts(@Query(zod(catalogQuerySchema)) query: CatalogQuery) {
    return this.catalog.listProducts(query);
  }

  @Public()
  @Get('products/:slug')
  @ApiOperation({ summary: 'One product with variants, media and attributes' })
  getProduct(@Param('slug') slug: string) {
    return this.catalog.getProduct(slug);
  }

  @Public()
  @Get('collections')
  @ApiOperation({ summary: 'Published collections' })
  listCollections() {
    return this.catalog.listCollections();
  }

  @Public()
  @Get('collections/:slug')
  @ApiOperation({ summary: 'One collection with its products' })
  getCollection(@Param('slug') slug: string, @Query(zod(catalogQuerySchema)) query: CatalogQuery) {
    return this.catalog.getCollection(slug, query);
  }

  @Public()
  @Get('facets')
  @ApiOperation({ summary: 'Facet counts for the filter rail' })
  facets(@Query(zod(catalogQuerySchema)) query: CatalogQuery) {
    return this.catalog.facets(query);
  }

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Typo-tolerant instant search over products and collections' })
  search(@Query('q') q = '') {
    return this.catalog.search(q);
  }
}
