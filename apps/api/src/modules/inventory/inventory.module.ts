import { Module } from '@nestjs/common';
import { CatalogAdminModule } from '../catalog/admin/catalog-admin.module.js';
import {
  InventoryController,
  LocationsController,
  PurchaseOrdersController,
  StockCountsController,
  SuppliersController,
  VariantSearchController,
} from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { LocationsService } from './locations.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { StockCountsService } from './stock-counts.service.js';
import { StockLedgerService } from './stock-ledger.service.js';
import { SuppliersService } from './suppliers.service.js';
import { VariantSearchService } from './variant-search.service.js';

/**
 * Inventory and purchasing — PRD F-AD-50 to F-AD-53.
 *
 * `StockLedgerService` and `LocationsService` are exported because orders (M3),
 * returns and delivery (M4) all move stock, and they must move it through the same
 * ledger rather than by touching `inventory_levels` themselves.
 */
@Module({
  imports: [CatalogAdminModule],
  controllers: [
    InventoryController,
    LocationsController,
    SuppliersController,
    PurchaseOrdersController,
    StockCountsController,
    VariantSearchController,
  ],
  providers: [
    StockLedgerService,
    InventoryService,
    LocationsService,
    SuppliersService,
    PurchaseOrdersService,
    StockCountsService,
    VariantSearchService,
  ],
  exports: [StockLedgerService, LocationsService, InventoryService, VariantSearchService],
})
export class InventoryModule {}
