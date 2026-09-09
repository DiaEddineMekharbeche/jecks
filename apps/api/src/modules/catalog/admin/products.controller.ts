import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adminListQuerySchema,
  bulkIdsSchema,
  priceScheduleInputSchema,
  productArchiveSchema,
  productBulkUpdateSchema,
  productDuplicateSchema,
  productImportOptionsSchema,
  productInputSchema,
  productPatchSchema,
  variantGenerateSchema,
  variantReorderSchema,
  variantsPatchSchema,
  type AdminListQuery,
  type PriceScheduleInput,
  type ProductBulkUpdateInput,
  type ProductDuplicateInput,
  type ProductInput,
  type ProductListFilters,
  type ProductPatchInput,
  type VariantGenerateInput,
  type VariantsPatchInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import { RawResponse, RequirePermissions } from '../../../common/decorators/auth.decorators.js';
import { AuditEntity } from '../../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../../common/list/export.service.js';
import { parseFilters } from '../../../common/list/list.helper.js';
import { zod } from '../../../common/pipes/zod-validation.pipe.js';
import { ProductImportService } from './product-import.service.js';
import { PRODUCT_EXPORT_COLUMNS, ProductsService } from './products.service.js';
import { VariantsService } from './variants.service.js';

/** A spreadsheet of 5 000 rows fits comfortably; anything larger is refused upstream. */
const IMPORT_LIMITS = { fileSize: 10 * 1024 * 1024, files: 1 };

@ApiTags('admin/products')
@ApiBearerAuth()
@AuditEntity('product')
@Controller('admin/products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly variants: VariantsService,
    private readonly importer: ProductImportService,
    private readonly exporter: ExportService,
  ) {}

  /** One endpoint serves the table and the export, as every admin list does (D29). */
  @Get()
  @RawResponse()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Products list, or a CSV/XLSX export of the same filter set' })
  @ApiQuery({ name: 'filter[status]', required: false, isArray: true })
  @ApiQuery({ name: 'filter[stock]', required: false, enum: ['in', 'low', 'out'] })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>) as ProductListFilters;

    if (query.format) {
      const rows = await this.products.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'produits', PRODUCT_EXPORT_COLUMNS, rows);
      return;
    }

    const result = await this.products.list(query, filters);
    response.json(result);
  }

  @Get('counts')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Per-status counters for the list tabs' })
  counts(@Req() request: Request) {
    const filters = parseFilters(request.query as Record<string, unknown>) as ProductListFilters;
    return this.products.statusCounts(filters);
  }

  @Get('import/template')
  @RawResponse()
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Blank import sheet with the expected columns and one example row' })
  async template(
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
    @Res() response: Response,
  ): Promise<void> {
    const [header = [], example = []] = this.importer.templateRows();
    await this.exporter.stream(
      response,
      format === 'xlsx' ? 'xlsx' : 'csv',
      'modele-import-produits',
      header.map((column, index) => ({
        header: column,
        value: (row: string[]) => row[index] ?? '',
        width: 22,
      })),
      [example],
    );
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'One product with variants, options, media and schedules' })
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Create a product with its first variants' })
  create(@Body(zod(productInputSchema)) body: ProductInput) {
    return this.products.create(body);
  }

  @Patch('bulk')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Bulk edit status, category, brand, collections, tags or prices' })
  bulk(@Body(zod(productBulkUpdateSchema)) body: ProductBulkUpdateInput) {
    return this.products.bulkUpdate(body);
  }

  @Post('archive')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Archive or restore a selection' })
  archive(@Body(zod(productArchiveSchema)) body: { ids: string[]; archived: boolean }) {
    return this.products.setArchived(body.ids, body.archived);
  }

  /**
   * The import is one request rather than a queued job: the report is only useful while
   * the operator is still looking at the file they uploaded.
   */
  @Post('import')
  @RequirePermissions('catalog.write')
  @UseInterceptors(FileInterceptor('file', { limits: IMPORT_LIMITS }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import products from CSV or XLSX; dry run by default' })
  async import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query(zod(productImportOptionsSchema))
    options: { dryRun: boolean; updateExisting: boolean },
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'NO_FILE',
        message: 'Attach a CSV or XLSX file',
      });
    }
    return this.importer.run(file, options);
  }

  @Patch(':id')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Update a product; only the keys sent are written' })
  update(@Param('id') id: string, @Body(zod(productPatchSchema)) body: ProductPatchInput) {
    return this.products.update(id, body);
  }

  @Post(':id/duplicate')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Copy a product as a new draft' })
  duplicate(
    @Param('id') id: string,
    @Body(zod(productDuplicateSchema)) body: ProductDuplicateInput,
  ) {
    return this.products.duplicate(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  @ApiOperation({ summary: 'Delete a product that has never been ordered' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.products.remove(id);
  }

  // --- variants -------------------------------------------------------------

  @Post(':id/variants/generate')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Rebuild the option sets and the variant matrix' })
  async generate(
    @Param('id') id: string,
    @Body(zod(variantGenerateSchema)) body: VariantGenerateInput,
  ) {
    await this.variants.generate(id, body);
    return this.products.get(id);
  }

  @Patch(':id/variants')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Write the variant grid' })
  async patchVariants(
    @Param('id') id: string,
    @Body(zod(variantsPatchSchema)) body: VariantsPatchInput,
  ) {
    await this.variants.patch(id, body);
    return this.products.get(id);
  }

  @Post(':id/variants/reorder')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Reorder variants' })
  async reorderVariants(
    @Param('id') id: string,
    @Body(zod(variantReorderSchema)) body: { ids: string[] },
  ) {
    await this.variants.reorder(id, body.ids);
    return this.products.get(id);
  }

  @Post(':id/price-schedules')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Schedule a price change for one or more variants' })
  schedulePrice(
    @Param('id') id: string,
    @Body(zod(priceScheduleInputSchema)) body: PriceScheduleInput,
  ) {
    return this.variants.schedulePrice(id, body);
  }

  @Delete(':id/price-schedules/:scheduleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Cancel a price change that has not run yet' })
  async cancelSchedule(@Param('scheduleId') scheduleId: string): Promise<void> {
    await this.variants.cancelSchedule(scheduleId);
  }

  @Post('delete')
  @RequirePermissions('catalog.delete')
  @ApiOperation({ summary: 'Delete a selection of never-ordered products' })
  async bulkDelete(@Body(zod(bulkIdsSchema)) body: { ids: string[] }) {
    const failed: Array<{ id: string; message: string }> = [];
    let deleted = 0;

    for (const id of body.ids) {
      try {
        await this.products.remove(id);
        deleted += 1;
      } catch (error) {
        failed.push({
          id,
          message: error instanceof Error ? error.message : 'Could not be deleted',
        });
      }
    }

    return { deleted, failed };
  }
}
