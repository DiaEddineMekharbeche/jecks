import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  StockMovementReason,
  type AdminListQuery,
  type AdminListResponse,
  type InventoryListFilters,
  type InventoryRow,
  type InventorySummary,
  type StockAdjustInput,
  type StockBulkAdjustInput,
  type StockMovementRow,
  type StockTransferInput,
  type Translated,
} from '@jecks/shared';
import type { ExportColumn } from '../../common/list/export.service.js';
import { andWhere, listResponse, planExport, planList } from '../../common/list/list.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RollupsService } from '../catalog/admin/rollups.service.js';
import { StorageService } from '../storage/storage.service.js';
import { stockState } from './costing.js';
import { StockLedgerService } from './stock-ledger.service.js';

/**
 * Stock overview and the operations on it — PRD F-AD-50 and F-AD-51.
 *
 * The list is one row per variant and location, because that is the unit an operator
 * actually acts on: "twelve of this shirt in Alger, none in Oran" is two different
 * decisions. Product-level totals live on `products.totalStock` and are refreshed by
 * `RollupsService` after every write here.
 */

const SORTABLE: Record<string, string> = {
  onHand: 'onHand',
  reserved: 'reserved',
  updatedAt: 'updatedAt',
  sku: 'variant.sku',
  location: 'location.name',
};

const MOVEMENT_SORTABLE: Record<string, string> = {
  createdAt: 'createdAt',
  quantity: 'quantity',
  sku: 'variant.sku',
};

const LEVEL_INCLUDE = {
  location: { select: { id: true, name: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
      barcode: true,
      costPrice: true,
      price: true,
      product: {
        select: {
          id: true,
          name: true,
          lowStockThreshold: true,
          media: {
            where: { position: 0 },
            take: 1,
            select: { media: { select: { storageKey: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.InventoryLevelInclude;

type LevelRow = Prisma.InventoryLevelGetPayload<{ include: typeof LEVEL_INCLUDE }>;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly rollups: RollupsService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  // --- reads ----------------------------------------------------------------

  async list(
    query: AdminListQuery,
    filters: InventoryListFilters,
  ): Promise<AdminListResponse<InventoryRow>> {
    const where = this.buildWhere(query, filters);
    const plan = planList(query, SORTABLE, 'onHand');

    const [rows, total] = await Promise.all([
      this.prisma.inventoryLevel.findMany({
        where,
        include: LEVEL_INCLUDE,
        orderBy: plan.orderBy as Prisma.InventoryLevelOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
      }),
      this.prisma.inventoryLevel.count({ where }),
    ]);

    // The stock buckets are a computed predicate, not a column, so they are applied
    // after the page is read. That is honest for a filter an operator uses to spot a
    // handful of problem rows, and it keeps the low-stock rule in one place.
    const mapped = rows.map((row) => this.toRow(row));
    const states = filters.state ?? [];
    const filtered = states.length > 0 ? mapped.filter((row) => states.includes(row.state)) : mapped;

    return listResponse(query, filtered, states.length > 0 ? filtered.length : total);
  }

  async listForExport(
    query: AdminListQuery,
    filters: InventoryListFilters,
  ): Promise<InventoryRow[]> {
    const where = this.buildWhere(query, filters);
    const total = await this.prisma.inventoryLevel.count({ where });
    const { take } = planExport(total);
    const plan = planList({ ...query, page: 1 }, SORTABLE, 'onHand');

    const rows = await this.prisma.inventoryLevel.findMany({
      where,
      include: LEVEL_INCLUDE,
      orderBy: plan.orderBy as Prisma.InventoryLevelOrderByWithRelationInput,
      take,
    });

    const mapped = rows.map((row) => this.toRow(row));
    const states = filters.state ?? [];
    return states.length > 0 ? mapped.filter((row) => states.includes(row.state)) : mapped;
  }

  /** The tiles above the table: what the warehouse holds and what it is worth. */
  async summary(filters: InventoryListFilters): Promise<InventorySummary> {
    const where = this.buildWhere({ page: 1, pageSize: 1, order: 'desc' }, filters);

    const rows = await this.prisma.inventoryLevel.findMany({
      where,
      select: {
        onHand: true,
        reserved: true,
        variant: {
          select: {
            costPrice: true,
            price: true,
            product: { select: { lowStockThreshold: true } },
          },
        },
      },
    });

    let valuation = 0n;
    let retail = 0n;
    let onHand = 0;
    let reserved = 0;
    let lowCount = 0;
    let outCount = 0;

    for (const row of rows) {
      onHand += row.onHand;
      reserved += row.reserved;
      const units = BigInt(Math.max(row.onHand, 0));
      valuation += row.variant.costPrice * units;
      retail += row.variant.price * units;
      const state = stockState(row, row.variant.product.lowStockThreshold);
      if (state === 'low') lowCount += 1;
      if (state === 'out' || state === 'negative') outCount += 1;
    }

    return {
      lines: rows.length,
      onHand,
      reserved,
      available: onHand - reserved,
      lowCount,
      outCount,
      valuationMinor: valuation.toString(),
      retailValueMinor: retail.toString(),
    };
  }

  async movements(
    query: AdminListQuery,
    filters: { variantId?: string[]; locationId?: string[]; reason?: string[]; referenceId?: string[] },
  ): Promise<AdminListResponse<StockMovementRow>> {
    const where = this.movementWhere(query, filters);
    const plan = planList(query, MOVEMENT_SORTABLE, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: plan.orderBy as Prisma.StockMovementOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
        include: MOVEMENT_INCLUDE,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return listResponse(query, rows.map(toMovementRow), total);
  }

  async movementsForExport(
    query: AdminListQuery,
    filters: { variantId?: string[]; locationId?: string[]; reason?: string[] },
  ): Promise<StockMovementRow[]> {
    const where = this.movementWhere(query, filters);
    const total = await this.prisma.stockMovement.count({ where });
    const { take } = planExport(total);
    const plan = planList({ ...query, page: 1 }, MOVEMENT_SORTABLE, 'createdAt');

    const rows = await this.prisma.stockMovement.findMany({
      where,
      orderBy: plan.orderBy as Prisma.StockMovementOrderByWithRelationInput,
      take,
      include: MOVEMENT_INCLUDE,
    });
    return rows.map(toMovementRow);
  }

  // --- writes ---------------------------------------------------------------

  async adjust(input: StockAdjustInput, actorId: string | null): Promise<InventoryRow> {
    const delta = await this.resolveDelta(input);

    await this.ledger.post({
      variantId: input.variantId,
      locationId: input.locationId,
      quantity: delta,
      reason: input.reason,
      referenceType: 'manual',
      note: input.note ?? null,
      actorId,
      // A manual correction is exactly how an operator fixes a level that already went
      // negative, so it is the one path that may leave stock below zero.
      allowNegative: true,
    });

    return this.afterWrite(input.variantId, input.locationId);
  }

  async bulkAdjust(
    input: StockBulkAdjustInput,
    actorId: string | null,
  ): Promise<{ updated: number }> {
    await this.ledger.postMany(
      input.lines.map((line) => ({
        variantId: line.variantId,
        locationId: input.locationId,
        quantity: line.quantity,
        reason: input.reason,
        referenceType: 'manual-bulk',
        note: input.note ?? null,
        actorId,
        allowNegative: true,
      })),
    );

    const productIds = await this.productIdsFor(input.lines.map((line) => line.variantId));
    await this.rollups.refreshProducts(productIds);
    await this.emitLowStock(input.lines.map((line) => line.variantId), input.locationId);

    return { updated: input.lines.length };
  }

  async transfer(input: StockTransferInput, actorId: string | null): Promise<InventoryRow> {
    await this.ledger.postMany([
      {
        variantId: input.variantId,
        locationId: input.fromLocationId,
        quantity: -input.quantity,
        reason: StockMovementReason.TRANSFER,
        referenceType: 'transfer',
        referenceId: null,
        note: input.note ?? null,
        actorId,
      },
      {
        variantId: input.variantId,
        locationId: input.toLocationId,
        quantity: input.quantity,
        reason: StockMovementReason.TRANSFER,
        referenceType: 'transfer',
        referenceId: null,
        note: input.note ?? null,
        actorId,
      },
    ]);

    return this.afterWrite(input.variantId, input.toLocationId);
  }

  // --- helpers --------------------------------------------------------------

  /** "Set to 12" is stored as the delta that gets there, so the ledger stays additive. */
  private async resolveDelta(input: StockAdjustInput): Promise<number> {
    if (input.mode === 'delta') return input.quantity;
    const level = await this.prisma.inventoryLevel.findUnique({
      where: {
        variantId_locationId: { variantId: input.variantId, locationId: input.locationId },
      },
      select: { onHand: true },
    });
    return input.quantity - (level?.onHand ?? 0);
  }

  private async afterWrite(variantId: string, locationId: string): Promise<InventoryRow> {
    const variant = await this.prisma.variant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    if (variant) await this.rollups.refreshProduct(variant.productId);
    await this.emitLowStock([variantId], locationId);

    const level = await this.prisma.inventoryLevel.findUnique({
      where: { variantId_locationId: { variantId, locationId } },
      include: LEVEL_INCLUDE,
    });
    if (!level) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stock level not found' });
    return this.toRow(level);
  }

  /**
   * Tells the admin when a write pushed something under its threshold. Fired here
   * rather than from a nightly job so the badge appears while the operator is still
   * looking at the screen that caused it.
   */
  private async emitLowStock(variantIds: string[], locationId: string): Promise<void> {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: { variantId: { in: variantIds }, locationId },
      include: LEVEL_INCLUDE,
    });

    for (const level of levels) {
      const row = this.toRow(level);
      if (row.state === 'in') continue;
      this.realtime.emit(
        'inventory.low',
        {
          variantId: row.variantId,
          sku: row.sku,
          productName: row.productName,
          locationName: row.locationName,
          available: row.available,
          state: row.state,
        },
        ['inventory.read'],
      );
    }
  }

  private async productIdsFor(variantIds: string[]): Promise<string[]> {
    const variants = await this.prisma.variant.findMany({
      where: { id: { in: variantIds } },
      select: { productId: true },
    });
    return [...new Set(variants.map((variant) => variant.productId))];
  }

  private buildWhere(
    query: AdminListQuery,
    filters: InventoryListFilters,
  ): Prisma.InventoryLevelWhereInput {
    const term = query.q?.trim();

    return andWhere(
      { variant: { deletedAt: null, product: { deletedAt: null } } },
      filters.locationId?.length ? { locationId: { in: filters.locationId } } : undefined,
      filters.productId?.length ? { variant: { productId: { in: filters.productId } } } : undefined,
      filters.categoryId?.length
        ? { variant: { product: { categoryId: { in: filters.categoryId } } } }
        : undefined,
      filters.brandId?.length
        ? { variant: { product: { brandId: { in: filters.brandId } } } }
        : undefined,
      term
        ? {
            OR: [
              { variant: { sku: { contains: term, mode: 'insensitive' } } },
              { variant: { barcode: { contains: term, mode: 'insensitive' } } },
              { variant: { product: { searchText: { contains: term.toLowerCase() } } } },
            ],
          }
        : undefined,
    ) as Prisma.InventoryLevelWhereInput;
  }

  private movementWhere(
    query: AdminListQuery,
    filters: { variantId?: string[]; locationId?: string[]; reason?: string[]; referenceId?: string[] },
  ): Prisma.StockMovementWhereInput {
    const term = query.q?.trim();
    return andWhere(
      filters.variantId?.length ? { variantId: { in: filters.variantId } } : undefined,
      filters.locationId?.length ? { locationId: { in: filters.locationId } } : undefined,
      filters.referenceId?.length ? { referenceId: { in: filters.referenceId } } : undefined,
      filters.reason?.length
        ? { reason: { in: filters.reason as Prisma.EnumStockMovementReasonFilter['in'] } }
        : undefined,
      term
        ? {
            OR: [
              { variant: { sku: { contains: term, mode: 'insensitive' } } },
              { note: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
    ) as Prisma.StockMovementWhereInput;
  }

  private toRow(level: LevelRow): InventoryRow {
    const threshold = level.variant.product.lowStockThreshold;
    const units = BigInt(Math.max(level.onHand, 0));

    return {
      variantId: level.variantId,
      productId: level.variant.product.id,
      productName: level.variant.product.name as Translated,
      variantName: level.variant.name,
      sku: level.variant.sku,
      barcode: level.variant.barcode,
      imageUrl: this.storage.publicUrl(level.variant.product.media[0]?.media.storageKey),
      locationId: level.locationId,
      locationName: level.location.name,
      onHand: level.onHand,
      reserved: level.reserved,
      available: level.onHand - level.reserved,
      incoming: level.incoming,
      lowStockThreshold: threshold,
      state: stockState(level, threshold),
      costPriceMinor: level.variant.costPrice.toString(),
      valuationMinor: (level.variant.costPrice * units).toString(),
      updatedAt: level.updatedAt.toISOString(),
    };
  }
}

const MOVEMENT_INCLUDE = {
  location: { select: { name: true } },
  actor: { select: { name: true } },
  variant: {
    select: { sku: true, name: true, product: { select: { name: true } } },
  },
} satisfies Prisma.StockMovementInclude;

type MovementRecord = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;

function toMovementRow(row: MovementRecord): StockMovementRow {
  return {
    id: row.id,
    variantId: row.variantId,
    sku: row.variant.sku,
    productName: row.variant.product.name as Translated,
    variantName: row.variant.name,
    locationId: row.locationId,
    locationName: row.location.name,
    quantity: row.quantity,
    balanceAfter: row.balanceAfter,
    reason: row.reason,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    note: row.note,
    actorName: row.actor?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const frName = (value: Translated): string => value.fr ?? Object.values(value)[0] ?? '';

export const INVENTORY_EXPORT_COLUMNS: ExportColumn<InventoryRow>[] = [
  { header: 'SKU', value: (row) => row.sku, width: 20 },
  { header: 'Produit', value: (row) => frName(row.productName), width: 36 },
  { header: 'Variante', value: (row) => row.variantName ?? '', width: 20 },
  { header: 'Emplacement', value: (row) => row.locationName, width: 18 },
  { header: 'En stock', value: (row) => row.onHand },
  { header: 'Réservé', value: (row) => row.reserved },
  { header: 'Disponible', value: (row) => row.available },
  { header: 'Entrant', value: (row) => row.incoming },
  { header: 'État', value: (row) => row.state },
  { header: 'Coût (DA)', value: (row) => Number(row.costPriceMinor) / 100 },
  { header: 'Valorisation (DA)', value: (row) => Number(row.valuationMinor) / 100 },
];

export const MOVEMENT_EXPORT_COLUMNS: ExportColumn<StockMovementRow>[] = [
  { header: 'Date', value: (row) => new Date(row.createdAt), width: 20 },
  { header: 'SKU', value: (row) => row.sku, width: 20 },
  { header: 'Produit', value: (row) => frName(row.productName), width: 36 },
  { header: 'Emplacement', value: (row) => row.locationName, width: 18 },
  { header: 'Quantité', value: (row) => row.quantity },
  { header: 'Solde', value: (row) => row.balanceAfter },
  { header: 'Motif', value: (row) => row.reason, width: 16 },
  { header: 'Référence', value: (row) => row.referenceType ?? '', width: 16 },
  { header: 'Note', value: (row) => row.note ?? '', width: 40 },
  { header: 'Par', value: (row) => row.actorName ?? '', width: 20 },
];
