import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adminListQuerySchema,
  attributeInputSchema,
  brandInputSchema,
  categoryMoveSchema,
  categoryPatchSchema,
  categoryReorderSchema,
  collectionInputSchema,
  collectionPatchSchema,
  collectionPreviewSchema,
  collectionProductsSchema,
  collectionReorderSchema,
  merchandisingSchema,
  reviewModerationSchema,
  reviewReplySchema,
  sizeGuideInputSchema,
  synonymInputSchema,
  tagInputSchema,
  type AdminListQuery,
  type AttributeInput,
  type BrandInput,
  type CategoryMoveInput,
  type CategoryPatchInput,
  type CategoryReorderInput,
  type CollectionInput,
  type CollectionPatchInput,
  type CollectionPreviewInput,
  type MerchandisingInput,
  type ReviewListFilters,
  type ReviewModerationInput,
  type SizeGuideInput,
  type SynonymInput,
  type TagInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import { RawResponse, RequirePermissions } from '../../../common/decorators/auth.decorators.js';
import { AuditEntity } from '../../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../../common/list/export.service.js';
import { parseFilters } from '../../../common/list/list.helper.js';
import { zod } from '../../../common/pipes/zod-validation.pipe.js';
import { CategoriesService } from './categories.service.js';
import { CollectionsService, type CollectionListFilters } from './collections.service.js';
import { REVIEW_EXPORT_COLUMNS, ReviewsService } from './reviews.service.js';
import { TaxonomyService } from './taxonomy.service.js';

/**
 * Categories — PRD F-AD-11. The tree is small enough to send whole, so there is no list
 * endpoint here: `GET /admin/categories` returns the nested structure the editor draws.
 */
@ApiTags('admin/categories')
@ApiBearerAuth()
@AuditEntity('category')
@Controller('admin/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'The whole category tree with per-node product counts' })
  tree() {
    return this.categories.tree();
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'One category and its subtree' })
  get(@Param('id') id: string) {
    return this.categories.get(id);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Create a category' })
  create(@Body(zod(categoryPatchSchema)) body: CategoryPatchInput) {
    return this.categories.create(body);
  }

  @Post('reorder')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Apply a whole reordered tree in one write' })
  reorder(@Body(zod(categoryReorderSchema)) body: CategoryReorderInput) {
    return this.categories.reorder(body);
  }

  @Patch(':id')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Rename, re-slug, or change the image and SEO of a category' })
  update(@Param('id') id: string, @Body(zod(categoryPatchSchema)) body: CategoryPatchInput) {
    return this.categories.update(id, body);
  }

  @Post(':id/move')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Move a category under a new parent and index' })
  move(@Param('id') id: string, @Body(zod(categoryMoveSchema)) body: CategoryMoveInput) {
    return this.categories.move(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  @ApiOperation({ summary: 'Delete an empty category' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.categories.remove(id);
  }
}

/** Collections, smart rules and merchandising — PRD F-AD-11 and F-AD-13. */
@ApiTags('admin/collections')
@ApiBearerAuth()
@AuditEntity('collection')
@Controller('admin/collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Collections with their live product counts' })
  @ApiQuery({ name: 'filter[isSmart]', required: false })
  list(@Query(zod(adminListQuerySchema)) query: AdminListQuery, @Req() request: Request) {
    const filters = parseFilters(request.query as Record<string, unknown>) as CollectionListFilters;
    return this.collections.list(query, filters);
  }

  /**
   * Preview runs before anything is saved, which is why it is a POST with the rules in
   * the body rather than a GET on a stored collection.
   */
  @Post('preview')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Products a rule set would select right now' })
  preview(@Body(zod(collectionPreviewSchema)) body: CollectionPreviewInput) {
    return this.collections.preview(body);
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'One collection with its rules' })
  get(@Param('id') id: string) {
    return this.collections.get(id);
  }

  @Get(':id/products')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Members of a collection with their pins, boosts and hides' })
  members(@Param('id') id: string) {
    return this.collections.members(id);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Create a manual or smart collection' })
  create(@Body(zod(collectionInputSchema)) body: CollectionInput) {
    return this.collections.create(body);
  }

  @Patch(':id')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Update a collection and replace its rules' })
  update(@Param('id') id: string, @Body(zod(collectionPatchSchema)) body: CollectionPatchInput) {
    return this.collections.update(id, body);
  }

  @Post(':id/products')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Add products to a manual collection' })
  addProducts(
    @Param('id') id: string,
    @Body(zod(collectionProductsSchema)) body: { productIds: string[] },
  ) {
    return this.collections.addProducts(id, body.productIds);
  }

  @Post(':id/products/remove')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Remove products from a manual collection' })
  removeProducts(
    @Param('id') id: string,
    @Body(zod(collectionProductsSchema)) body: { productIds: string[] },
  ) {
    return this.collections.removeProducts(id, body.productIds);
  }

  @Post(':id/products/reorder')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Reorder a manual collection' })
  reorderProducts(
    @Param('id') id: string,
    @Body(zod(collectionReorderSchema)) body: { productIds: string[] },
  ) {
    return this.collections.reorderProducts(id, body.productIds);
  }

  @Post(':id/merchandising')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Pin, hide or boost products inside a collection' })
  merchandise(@Param('id') id: string, @Body(zod(merchandisingSchema)) body: MerchandisingInput) {
    return this.collections.merchandise(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  @ApiOperation({ summary: 'Delete a collection nothing points at' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.collections.remove(id);
  }
}

/** Brands, tags, attributes, size guides and search synonyms. */
@ApiTags('admin/catalog')
@ApiBearerAuth()
@AuditEntity('catalog')
@Controller('admin')
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('brands')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Brands with product counts' })
  brands() {
    return this.taxonomy.listBrands();
  }

  @Post('brands')
  @RequirePermissions('catalog.write')
  createBrand(@Body(zod(brandInputSchema)) body: BrandInput) {
    return this.taxonomy.createBrand(body);
  }

  @Patch('brands/:id')
  @RequirePermissions('catalog.write')
  updateBrand(@Param('id') id: string, @Body(zod(brandInputSchema)) body: BrandInput) {
    return this.taxonomy.updateBrand(id, body);
  }

  @Delete('brands/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  async removeBrand(@Param('id') id: string): Promise<void> {
    await this.taxonomy.removeBrand(id);
  }

  @Get('tags')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Tags with product counts' })
  tags() {
    return this.taxonomy.listTags();
  }

  @Post('tags')
  @RequirePermissions('catalog.write')
  createTag(@Body(zod(tagInputSchema)) body: TagInput) {
    return this.taxonomy.createTag(body);
  }

  @Patch('tags/:id')
  @RequirePermissions('catalog.write')
  updateTag(@Param('id') id: string, @Body(zod(tagInputSchema)) body: TagInput) {
    return this.taxonomy.updateTag(id, body);
  }

  @Delete('tags/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  async removeTag(@Param('id') id: string): Promise<void> {
    await this.taxonomy.removeTag(id);
  }

  @Get('attributes')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Structured attributes offered by the product editor' })
  attributes() {
    return this.taxonomy.listAttributes();
  }

  @Post('attributes')
  @RequirePermissions('catalog.write')
  createAttribute(@Body(zod(attributeInputSchema)) body: AttributeInput) {
    return this.taxonomy.createAttribute(body);
  }

  @Patch('attributes/:id')
  @RequirePermissions('catalog.write')
  updateAttribute(@Param('id') id: string, @Body(zod(attributeInputSchema)) body: AttributeInput) {
    return this.taxonomy.updateAttribute(id, body);
  }

  @Delete('attributes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  async removeAttribute(@Param('id') id: string): Promise<void> {
    await this.taxonomy.removeAttribute(id);
  }

  @Get('size-guides')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Size guides, optionally scoped to a category' })
  sizeGuides() {
    return this.taxonomy.listSizeGuides();
  }

  @Post('size-guides')
  @RequirePermissions('catalog.write')
  createSizeGuide(@Body(zod(sizeGuideInputSchema)) body: SizeGuideInput) {
    return this.taxonomy.createSizeGuide(body);
  }

  @Patch('size-guides/:id')
  @RequirePermissions('catalog.write')
  updateSizeGuide(@Param('id') id: string, @Body(zod(sizeGuideInputSchema)) body: SizeGuideInput) {
    return this.taxonomy.updateSizeGuide(id, body);
  }

  @Delete('size-guides/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  async removeSizeGuide(@Param('id') id: string): Promise<void> {
    await this.taxonomy.removeSizeGuide(id);
  }

  @Get('search-synonyms')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Search synonyms applied to storefront queries' })
  synonyms() {
    return this.taxonomy.listSynonyms();
  }

  @Post('search-synonyms')
  @RequirePermissions('catalog.write')
  createSynonym(@Body(zod(synonymInputSchema)) body: SynonymInput) {
    return this.taxonomy.createSynonym(body);
  }

  @Patch('search-synonyms/:id')
  @RequirePermissions('catalog.write')
  updateSynonym(@Param('id') id: string, @Body(zod(synonymInputSchema)) body: SynonymInput) {
    return this.taxonomy.updateSynonym(id, body);
  }

  @Delete('search-synonyms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  async removeSynonym(@Param('id') id: string): Promise<void> {
    await this.taxonomy.removeSynonym(id);
  }
}

/** Review moderation — PRD F-AD-12. */
@ApiTags('admin/reviews')
@ApiBearerAuth()
@AuditEntity('review')
@Controller('admin/reviews')
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Moderation queue, or a CSV/XLSX export of the same filter set' })
  @ApiQuery({ name: 'filter[status]', required: false, isArray: true })
  @ApiQuery({ name: 'filter[rating]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>) as ReviewListFilters;

    if (query.format) {
      const rows = await this.reviews.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'avis', REVIEW_EXPORT_COLUMNS, rows);
      return;
    }

    response.json(await this.reviews.list(query, filters));
  }

  @Get('counts')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Per-status counters for the moderation tabs' })
  counts(@Req() request: Request) {
    const filters = parseFilters(request.query as Record<string, unknown>) as ReviewListFilters;
    return this.reviews.statusCounts(filters);
  }

  @Post('moderate')
  @RequirePermissions('reviews.moderate')
  @ApiOperation({ summary: 'Approve or reject one review or a selection' })
  moderate(@Body(zod(reviewModerationSchema)) body: ReviewModerationInput) {
    return this.reviews.moderate(body);
  }

  @Post(':id/reply')
  @RequirePermissions('reviews.moderate')
  @ApiOperation({ summary: 'Publish or clear the shop reply under a review' })
  reply(@Param('id') id: string, @Body(zod(reviewReplySchema)) body: { reply: string }) {
    return this.reviews.reply(id, body.reply);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reviews.moderate')
  @ApiOperation({ summary: 'Delete a review outright' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.reviews.remove(id);
  }
}
