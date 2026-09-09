import { Module } from '@nestjs/common';
import {
  CategoriesController,
  CollectionsController,
  ReviewsController,
  TaxonomyController,
} from './catalog-admin.controller.js';
import { CategoriesService } from './categories.service.js';
import { CollectionsService } from './collections.service.js';
import { ProductImportService } from './product-import.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { ReviewsService } from './reviews.service.js';
import { RollupsService } from './rollups.service.js';
import { TaxonomyService } from './taxonomy.service.js';
import { VariantsService } from './variants.service.js';

/**
 * Catalog administration — PRD F-AD-10 to F-AD-13.
 *
 * `RollupsService` is exported because inventory (M1.3) and order fulfilment (M3) both
 * move stock, and the denormalized columns on `products` have exactly one owner (D25).
 */
@Module({
  controllers: [
    ProductsController,
    CategoriesController,
    CollectionsController,
    TaxonomyController,
    ReviewsController,
  ],
  providers: [
    ProductsService,
    VariantsService,
    ProductImportService,
    CategoriesService,
    CollectionsService,
    TaxonomyService,
    ReviewsService,
    RollupsService,
  ],
  exports: [RollupsService, CollectionsService],
})
export class CatalogAdminModule {}
