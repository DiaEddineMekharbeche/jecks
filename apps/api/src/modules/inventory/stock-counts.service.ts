import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  INVENTORY_ERRORS,
  StockMovementReason,
  type AdminListQuery,
  type AdminListResponse,
  type StockCountDto,
  type StockCountEntryInput,
  type StockCountItemDto,
  type StockCountRow,
  type StockCountStartInput,
  type StockCountStatus,
  type Translated,
} from '@jecks/shared';
import type { ExportColumn } from '../../common/list/export.service.js';
import { andWhere, listResponse, planList } from '../../common/list/list.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RollupsService } from '../catalog/admin/rollups.service.js';
import { StockLedgerService } from './stock-ledger.service.js';

/**
 * Stock counts — PRD F-AD-51.
 *
 * A session freezes the expected quantity when it opens, the operator types what is
 * physically on the shelf, and applying the session posts one movement per line that
 * differs. Freezing the expectation is the point: a count that compared against live
 * stock would blame the counter for every sale that happened while they were counting.
 */

const SORTABLE: Record<string, string> = {
  startedAt: 'startedAt',
  name: 'name',
  status: 'status',
};

const INCLUDE = {
  location: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          costPrice: true,
          productId: true,
          product: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.StockCountInclude;

type StockCountRecord = Prisma.StockCountGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class StockCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly rollups: RollupsService,
  ) {}

  async list(
    query: AdminListQuery,
    filters: { status?: string[]; locationId?: string[] },
  ): Promise<AdminListResponse<StockCountRow>> {
    const where = andWhere(
      filters.status?.length ? { status: { in: filters.status } } : undefined,
      filters.locationId?.length ? { locationId: { in: filters.locationId } } : undefined,
      query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : undefined,
    ) as Prisma.StockCountWhereInput;

    const plan = planList(query, SORTABLE, 'startedAt');
    const [rows, total] = await Promise.all([
      this.prisma.stockCount.findMany({
        where,
        include: INCLUDE,
        orderBy: plan.orderBy as Prisma.StockCountOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
      }),
      this.prisma.stockCount.count({ where }),
    ]);

    return listResponse(query, rows.map(toRow), total);
  }

  async get(id: string): Promise<StockCountDto> {
    const row = await this.prisma.stockCount.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stock count not found' });
    return { ...toRow(row), note: row.note, items: row.items.map(toItem) };
  }

  /** Opens a session, snapshotting the expected quantity for every line it covers. */
  async start(input: StockCountStartInput): Promise<StockCountDto> {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: {
        locationId: input.locationId,
        variant: {
          deletedAt: null,
          product: { deletedAt: null, ...(input.categoryId ? { categoryId: input.categoryId } : {}) },
          ...(input.variantIds?.length ? { id: { in: input.variantIds } } : {}),
        },
      },
      select: { variantId: true, onHand: true },
    });

    if (levels.length === 0) {
      throw new ConflictException({
        code: 'NOTHING_TO_COUNT',
        message: 'No stocked variants match that selection',
      });
    }

    const created = await this.prisma.stockCount.create({
      data: {
        locationId: input.locationId,
        name: input.name,
        status: 'OPEN',
        note: input.note ?? null,
        items: {
          create: levels.map((level) => ({
            variantId: level.variantId,
            expectedQuantity: level.onHand,
          })),
        },
      },
      select: { id: true },
    });

    return this.get(created.id);
  }

  /** Saves typed counts. Sent in batches as the operator works down the shelf. */
  async enter(id: string, input: StockCountEntryInput): Promise<StockCountDto> {
    const count = await this.requireOpen(id);
    const known = new Map(count.items.map((item) => [item.id, item]));

    await this.prisma.$transaction(
      input.lines
        .filter((line) => known.has(line.itemId))
        .map((line) => {
          const item = known.get(line.itemId)!;
          return this.prisma.stockCountItem.update({
            where: { id: line.itemId },
            data: {
              countedQuantity: line.countedQuantity,
              variance:
                line.countedQuantity === null
                  ? null
                  : line.countedQuantity - item.expectedQuantity,
            },
          });
        }),
    );

    return this.get(id);
  }

  /**
   * Applies the session: every counted line whose variance is non-zero becomes one
   * `STOCK_COUNT` movement. Uncounted lines are left alone rather than assumed to be
   * zero, which is the difference between "we did not get to that shelf" and "that
   * shelf is empty".
   */
  async apply(id: string, actorId: string | null): Promise<StockCountDto> {
    const count = await this.requireOpen(id);
    const adjustments = count.items.filter(
      (item) => item.countedQuantity !== null && item.countedQuantity !== item.expectedQuantity,
    );

    await this.prisma.$transaction(async (tx) => {
      for (const item of adjustments) {
        // The delta is measured against live stock, not against the frozen expectation:
        // sales that happened during the count are real and must survive it.
        const level = await tx.inventoryLevel.findUnique({
          where: {
            variantId_locationId: { variantId: item.variantId, locationId: count.locationId },
          },
          select: { onHand: true },
        });
        const delta = (item.countedQuantity ?? 0) - (level?.onHand ?? 0);
        if (delta === 0) continue;

        await this.ledger.postWithin(tx, {
          variantId: item.variantId,
          locationId: count.locationId,
          quantity: delta,
          reason: StockMovementReason.STOCK_COUNT,
          referenceType: 'stock_count',
          referenceId: count.id,
          note: count.name,
          actorId,
          allowNegative: true,
        });
      }

      await tx.stockCount.update({
        where: { id },
        data: { status: 'APPLIED', closedAt: new Date() },
      });
    });

    await this.rollups.refreshProducts(adjustments.map((item) => item.variant.productId));
    return this.get(id);
  }

  async cancel(id: string): Promise<StockCountDto> {
    await this.requireOpen(id);
    await this.prisma.stockCount.update({
      where: { id },
      data: { status: 'CANCELLED', closedAt: new Date() },
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const count = await this.prisma.stockCount.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stock count not found' });
    if (count.status === 'APPLIED') {
      throw new ConflictException({
        code: INVENTORY_ERRORS.COUNT_CLOSED,
        message: 'An applied count is part of the stock history and cannot be deleted',
      });
    }
    await this.prisma.stockCount.delete({ where: { id } });
  }

  private async requireOpen(id: string): Promise<StockCountRecord> {
    const count = await this.prisma.stockCount.findUnique({ where: { id }, include: INCLUDE });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stock count not found' });
    if (count.status !== 'OPEN') {
      throw new ConflictException({
        code: INVENTORY_ERRORS.COUNT_CLOSED,
        message: `This count is ${count.status.toLowerCase()} and no longer accepts changes`,
        details: { status: count.status },
      });
    }
    return count;
  }
}

function toItem(item: StockCountRecord['items'][number]): StockCountItemDto {
  const variance = item.variance ?? null;
  return {
    id: item.id,
    variantId: item.variantId,
    sku: item.variant.sku,
    productName: item.variant.product.name as Translated,
    variantName: item.variant.name,
    expectedQuantity: item.expectedQuantity,
    countedQuantity: item.countedQuantity,
    variance,
    varianceValueMinor: (item.variant.costPrice * BigInt(variance ?? 0)).toString(),
  };
}

function toRow(row: StockCountRecord): StockCountRow {
  const counted = row.items.filter((item) => item.countedQuantity !== null);
  const varianceUnits = counted.reduce((sum, item) => sum + (item.variance ?? 0), 0);
  const varianceValue = counted.reduce(
    (sum, item) => sum + item.variant.costPrice * BigInt(item.variance ?? 0),
    0n,
  );

  return {
    id: row.id,
    name: row.name,
    locationId: row.locationId,
    locationName: row.location.name,
    status: row.status as StockCountStatus,
    itemCount: row.items.length,
    countedCount: counted.length,
    varianceUnits,
    varianceValueMinor: varianceValue.toString(),
    startedAt: row.startedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

export const STOCK_COUNT_EXPORT_COLUMNS: ExportColumn<StockCountItemDto>[] = [
  { header: 'SKU', value: (row) => row.sku, width: 20 },
  { header: 'Produit', value: (row) => row.productName.fr ?? '', width: 36 },
  { header: 'Variante', value: (row) => row.variantName ?? '', width: 20 },
  { header: 'Attendu', value: (row) => row.expectedQuantity },
  { header: 'Compté', value: (row) => row.countedQuantity ?? '' },
  { header: 'Écart', value: (row) => row.variance ?? '' },
  { header: 'Valeur écart (DA)', value: (row) => Number(row.varianceValueMinor) / 100 },
];
