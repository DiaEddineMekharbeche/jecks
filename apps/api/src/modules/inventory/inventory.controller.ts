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
  locationInputSchema,
  purchaseOrderInputSchema,
  purchaseOrderPatchSchema,
  purchaseOrderReceiveSchema,
  stockAdjustSchema,
  stockBulkAdjustSchema,
  stockCountEntrySchema,
  stockCountStartSchema,
  stockTransferSchema,
  supplierInputSchema,
  type AdminListQuery,
  type InventoryListFilters,
  type LocationInput,
  type PurchaseOrderInput,
  type PurchaseOrderListFilters,
  type PurchaseOrderPatchInput,
  type PurchaseOrderReceiveInput,
  type StockAdjustInput,
  type StockBulkAdjustInput,
  type StockCountEntryInput,
  type StockCountStartInput,
  type StockTransferInput,
  type SupplierInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  RawResponse,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { AuditEntity } from '../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../common/list/export.service.js';
import { parseFilters } from '../../common/list/list.helper.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import {
  INVENTORY_EXPORT_COLUMNS,
  InventoryService,
  MOVEMENT_EXPORT_COLUMNS,
} from './inventory.service.js';
import { LocationsService } from './locations.service.js';
import {
  PURCHASE_ORDER_EXPORT_COLUMNS,
  PurchaseOrdersService,
} from './purchase-orders.service.js';
import { STOCK_COUNT_EXPORT_COLUMNS, StockCountsService } from './stock-counts.service.js';
import { SUPPLIER_EXPORT_COLUMNS, SuppliersService } from './suppliers.service.js';
import { VariantSearchService } from './variant-search.service.js';

/** Stock levels, adjustments and the movement ledger — PRD F-AD-50, F-AD-51. */
@ApiTags('admin/inventory')
@ApiBearerAuth()
@AuditEntity('inventory')
@Controller('admin/inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Stock levels per variant and location, or an export of them' })
  @ApiQuery({ name: 'filter[locationId]', required: false, isArray: true })
  @ApiQuery({ name: 'filter[state]', required: false, isArray: true })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>) as InventoryListFilters;

    if (query.format) {
      const rows = await this.inventory.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'stock', INVENTORY_EXPORT_COLUMNS, rows);
      return;
    }

    const result = await this.inventory.list(query, filters);
    response.json(result);
  }

  @Get('summary')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'On-hand, reserved, low and out counts plus valuation' })
  summary(@Req() request: Request) {
    const filters = parseFilters(request.query as Record<string, unknown>) as InventoryListFilters;
    return this.inventory.summary(filters);
  }

  @Get('movements')
  @RawResponse()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'The stock movement ledger' })
  async movements(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>);

    if (query.format) {
      const rows = await this.inventory.movementsForExport(query, filters);
      await this.exporter.stream(
        response,
        query.format,
        'mouvements-stock',
        MOVEMENT_EXPORT_COLUMNS,
        rows,
      );
      return;
    }

    response.json(await this.inventory.movements(query, filters));
  }

  @Post('adjust')
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Adjust one level with a reason, writing the ledger' })
  adjust(
    @Body(zod(stockAdjustSchema)) body: StockAdjustInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.adjust(body, user.id);
  }

  @Post('bulk-adjust')
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Adjust many levels at one location in a single transaction' })
  bulkAdjust(
    @Body(zod(stockBulkAdjustSchema)) body: StockBulkAdjustInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.bulkAdjust(body, user.id);
  }

  @Post('transfer')
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Move units between two locations' })
  transfer(
    @Body(zod(stockTransferSchema)) body: StockTransferInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.transfer(body, user.id);
  }
}

/** Stock locations — PRD F-AD-50. */
@ApiTags('admin/locations')
@ApiBearerAuth()
@AuditEntity('location')
@Controller('admin/locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Every stock location with its unit count' })
  list() {
    return this.locations.list();
  }

  @Post()
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Create a location' })
  create(@Body(zod(locationInputSchema)) body: LocationInput) {
    return this.locations.create(body);
  }

  @Patch(':id')
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Update a location' })
  update(@Param('id') id: string, @Body(zod(locationInputSchema)) body: LocationInput) {
    return this.locations.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Delete an empty location' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.locations.remove(id);
  }
}

/** Suppliers — PRD F-AD-52. */
@ApiTags('admin/suppliers')
@ApiBearerAuth()
@AuditEntity('supplier')
@Controller('admin/suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'Suppliers with their purchase totals' })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>);

    if (query.format) {
      const rows = await this.suppliers.listForExport(query, filters);
      await this.exporter.stream(
        response,
        query.format,
        'fournisseurs',
        SUPPLIER_EXPORT_COLUMNS,
        rows,
      );
      return;
    }

    response.json(await this.suppliers.list(query, filters));
  }

  @Get('options')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'Active suppliers, for pickers' })
  options() {
    return this.suppliers.options();
  }

  @Get(':id')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'One supplier' })
  get(@Param('id') id: string) {
    return this.suppliers.get(id);
  }

  @Post()
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Create a supplier' })
  create(@Body(zod(supplierInputSchema)) body: SupplierInput) {
    return this.suppliers.create(body);
  }

  @Patch(':id')
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Update a supplier' })
  update(@Param('id') id: string, @Body(zod(supplierInputSchema)) body: SupplierInput) {
    return this.suppliers.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Archive a supplier' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.suppliers.remove(id);
  }
}

/** Purchase orders and receiving — PRD F-AD-52. */
@ApiTags('admin/purchase-orders')
@ApiBearerAuth()
@AuditEntity('purchase_order')
@Controller('admin/purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'Purchase orders, or an export of the same filter set' })
  @ApiQuery({ name: 'filter[status]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(
      request.query as Record<string, unknown>,
    ) as PurchaseOrderListFilters;

    if (query.format) {
      const rows = await this.purchaseOrders.listForExport(query, filters);
      await this.exporter.stream(
        response,
        query.format,
        'commandes-fournisseur',
        PURCHASE_ORDER_EXPORT_COLUMNS,
        rows,
      );
      return;
    }

    response.json(await this.purchaseOrders.list(query, filters));
  }

  @Get('counts')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'Row counts per status, for the list tabs' })
  counts() {
    return this.purchaseOrders.counts();
  }

  @Get(':id')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'One purchase order with its lines' })
  get(@Param('id') id: string) {
    return this.purchaseOrders.get(id);
  }

  @Post()
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Create a draft purchase order' })
  create(@Body(zod(purchaseOrderInputSchema)) body: PurchaseOrderInput) {
    return this.purchaseOrders.create(body);
  }

  @Patch(':id')
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Edit a draft purchase order' })
  update(
    @Param('id') id: string,
    @Body(zod(purchaseOrderPatchSchema)) body: PurchaseOrderPatchInput,
  ) {
    return this.purchaseOrders.update(id, body);
  }

  @Post(':id/place')
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Send the order to the supplier and count it as incoming' })
  place(@Param('id') id: string) {
    return this.purchaseOrders.place(id);
  }

  @Post(':id/receive')
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Receive units, updating on-hand and the weighted-average cost' })
  receive(
    @Param('id') id: string,
    @Body(zod(purchaseOrderReceiveSchema)) body: PurchaseOrderReceiveInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.purchaseOrders.receive(id, body, user.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Cancel an order and release its incoming units' })
  cancel(@Param('id') id: string) {
    return this.purchaseOrders.cancel(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('purchasing.write')
  @ApiOperation({ summary: 'Delete a draft purchase order' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.purchaseOrders.remove(id);
  }
}

/** Stock count sessions — PRD F-AD-51. */
@ApiTags('admin/stock-counts')
@ApiBearerAuth()
@AuditEntity('stock_count')
@Controller('admin/stock-counts')
export class StockCountsController {
  constructor(
    private readonly counts: StockCountsService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Count sessions with their variance totals' })
  list(@Query(zod(adminListQuerySchema)) query: AdminListQuery, @Req() request: Request) {
    return this.counts.list(query, parseFilters(request.query as Record<string, unknown>));
  }

  @Get(':id')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'One count session with its lines' })
  get(@Param('id') id: string) {
    return this.counts.get(id);
  }

  @Get(':id/export')
  @RawResponse()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Variance report for one session' })
  async export(
    @Param('id') id: string,
    @Query('format') format: 'csv' | 'xlsx' = 'xlsx',
    @Res() response: Response,
  ): Promise<void> {
    const session = await this.counts.get(id);
    await this.exporter.stream(
      response,
      format === 'csv' ? 'csv' : 'xlsx',
      `inventaire-${session.name}`,
      STOCK_COUNT_EXPORT_COLUMNS,
      session.items,
    );
  }

  @Post()
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Open a count session, freezing expected quantities' })
  start(@Body(zod(stockCountStartSchema)) body: StockCountStartInput) {
    return this.counts.start(body);
  }

  @Patch(':id/entries')
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Save counted quantities' })
  enter(@Param('id') id: string, @Body(zod(stockCountEntrySchema)) body: StockCountEntryInput) {
    return this.counts.enter(id, body);
  }

  @Post(':id/apply')
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Apply the variances as stock movements and close the session' })
  apply(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.apply(id, user.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Abandon a session without touching stock' })
  cancel(@Param('id') id: string) {
    return this.counts.cancel(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('inventory.write')
  @ApiOperation({ summary: 'Delete an unapplied session' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.counts.remove(id);
  }
}

/** Variant lookup shared by purchasing, manual orders and returns. */
@ApiTags('admin/variants')
@ApiBearerAuth()
@Controller('admin/variants')
export class VariantSearchController {
  constructor(private readonly variants: VariantSearchService) {}

  @Get('search')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Find variants by SKU, barcode or product name' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  search(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.variants.search(q, limit ? Number(limit) : 20, locationId);
  }
}
