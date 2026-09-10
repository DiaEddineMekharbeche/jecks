import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  INVENTORY_ERRORS,
  PurchaseOrderStatus,
  StockMovementReason,
  type AdminListQuery,
  type AdminListResponse,
  type PurchaseOrderDto,
  type PurchaseOrderInput,
  type PurchaseOrderListFilters,
  type PurchaseOrderPatchInput,
  type PurchaseOrderReceiveInput,
  type PurchaseOrderRow,
  type Translated,
} from '@jecks/shared';
import type { ExportColumn } from '../../common/list/export.service.js';
import { andWhere, listResponse, planExport, planList } from '../../common/list/list.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RollupsService } from '../catalog/admin/rollups.service.js';
import { StorageService } from '../storage/storage.service.js';
import { allocateByValue, landedUnitCost, purchaseOrderTotals, weightedAverageCost } from './costing.js';
import { StockLedgerService } from './stock-ledger.service.js';

/**
 * Purchase orders — PRD F-AD-52, and the milestone's definition of done: receiving
 * twenty units at 900 DA must move on-hand, write the ledger, and reprice the variant
 * by weighted average.
 *
 * The status graph is deliberately small: DRAFT is editable, ORDERED is committed and
 * counts as incoming stock, receiving moves it to PARTIALLY_RECEIVED or RECEIVED, and
 * CANCELLED is terminal. Receiving is the only step that touches stock.
 */

const SORTABLE: Record<string, string> = {
  createdAt: 'createdAt',
  number: 'number',
  total: 'total',
  expectedAt: 'expectedAt',
  status: 'status',
  supplier: 'supplier.name',
};

const EDITABLE_STATUSES: PurchaseOrderStatus[] = [PurchaseOrderStatus.DRAFT];
const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

const INCLUDE = {
  supplier: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          product: {
            select: {
              id: true,
              name: true,
              media: {
                where: { position: 0 },
                take: 1,
                select: { media: { select: { storageKey: true } } },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderRecord = Prisma.PurchaseOrderGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly rollups: RollupsService,
    private readonly storage: StorageService,
  ) {}

  // --- reads ----------------------------------------------------------------

  async list(
    query: AdminListQuery,
    filters: PurchaseOrderListFilters,
  ): Promise<AdminListResponse<PurchaseOrderRow>> {
    const where = this.buildWhere(query, filters);
    const plan = planList(query, SORTABLE, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: INCLUDE,
        orderBy: plan.orderBy as Prisma.PurchaseOrderOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return listResponse(query, rows.map((row) => this.toRow(row)), total);
  }

  async listForExport(
    query: AdminListQuery,
    filters: PurchaseOrderListFilters,
  ): Promise<PurchaseOrderRow[]> {
    const where = this.buildWhere(query, filters);
    const total = await this.prisma.purchaseOrder.count({ where });
    const { take } = planExport(total);
    const rows = await this.prisma.purchaseOrder.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((row) => this.toRow(row));
  }

  /** Status counters for the list tabs. */
  async counts(): Promise<Record<string, number>> {
    const grouped = await this.prisma.purchaseOrder.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out: Record<string, number> = { ALL: 0 };
    for (const group of grouped) {
      out[group.status] = group._count._all;
      out.ALL += group._count._all;
    }
    return out;
  }

  async get(id: string): Promise<PurchaseOrderDto> {
    const row = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: INCLUDE });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Purchase order not found' });
    }
    return this.toDto(row);
  }

  // --- writes ---------------------------------------------------------------

  async create(input: PurchaseOrderInput): Promise<PurchaseOrderDto> {
    await this.assertVariantsExist(input.items.map((item) => item.variantId));
    const totals = purchaseOrderTotals(input);

    const created = await this.prisma.purchaseOrder.create({
      data: {
        number: await this.nextNumber(),
        supplierId: input.supplierId,
        locationId: input.locationId,
        status: PurchaseOrderStatus.DRAFT,
        subtotal: totals.subtotal,
        shippingCost: input.shippingCost,
        otherCost: input.otherCost,
        total: totals.total,
        expectedAt: input.expectedAt ?? null,
        note: input.note ?? null,
        items: {
          create: input.items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            unitCost: item.unitCost,
          })),
        },
      },
      select: { id: true },
    });

    return this.get(created.id);
  }

  async update(id: string, input: PurchaseOrderPatchInput): Promise<PurchaseOrderDto> {
    const current = await this.requireOrder(id);
    if (!EDITABLE_STATUSES.includes(current.status as PurchaseOrderStatus)) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.PO_NOT_EDITABLE,
        message: `A ${current.status.toLowerCase()} purchase order can no longer be edited`,
        details: { status: current.status },
      });
    }

    const items = input.items ?? current.items.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      unitCost: item.unitCost,
    }));
    if (input.items) await this.assertVariantsExist(input.items.map((item) => item.variantId));

    const shippingCost = input.shippingCost ?? current.shippingCost;
    const otherCost = input.otherCost ?? current.otherCost;
    const totals = purchaseOrderTotals({ items, shippingCost, otherCost });

    await this.prisma.$transaction(async (tx) => {
      if (input.items) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderItem.createMany({
          data: input.items.map((item) => ({
            purchaseOrderId: id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitCost: item.unitCost,
          })),
        });
      }

      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: input.supplierId ?? current.supplierId,
          locationId: input.locationId ?? current.locationId,
          expectedAt: input.expectedAt ?? current.expectedAt,
          shippingCost,
          otherCost,
          subtotal: totals.subtotal,
          total: totals.total,
          note: input.note ?? current.note,
        },
      });
    });

    return this.get(id);
  }

  /**
   * DRAFT to ORDERED. The units become `incoming` at this point, which is what makes a
   * buyer stop re-ordering something already on its way.
   */
  async place(id: string): Promise<PurchaseOrderDto> {
    const order = await this.requireOrder(id);
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.PO_NOT_EDITABLE,
        message: 'Only a draft purchase order can be placed',
        details: { status: order.status },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await this.ledger.adjustIncomingWithin(tx, item.variantId, order.locationId, item.quantity);
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: PurchaseOrderStatus.ORDERED, orderedAt: new Date() },
      });
    });

    return this.get(id);
  }

  /**
   * Receiving — the milestone's acceptance case.
   *
   * Freight and other order-level costs are allocated across the received lines by
   * value, so a receipt that cost 2 000 DA to ship raises the landed cost of the
   * expensive lines more than the cheap ones. Each line then re-averages the variant's
   * cost against everything already on hand, everywhere, because `costPrice` is a
   * property of the variant and not of a warehouse.
   */
  async receive(
    id: string,
    input: PurchaseOrderReceiveInput,
    actorId: string | null,
  ): Promise<PurchaseOrderDto> {
    const order = await this.requireOrder(id);
    if (!RECEIVABLE_STATUSES.includes(order.status as PurchaseOrderStatus)) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.PO_NOT_RECEIVABLE,
        message: `A ${order.status.toLowerCase()} purchase order cannot be received`,
        details: { status: order.status },
      });
    }

    const byId = new Map(order.items.map((item) => [item.id, item]));
    const lines = input.lines.filter((line) => line.quantity > 0);

    for (const line of lines) {
      const item = byId.get(line.itemId);
      if (!item) {
        throw new BadRequestException({
          code: 'NOT_FOUND',
          message: 'A received line does not belong to this purchase order',
          details: { itemId: line.itemId },
        });
      }
      const outstanding = item.quantity - item.receivedQuantity;
      if (line.quantity > outstanding) {
        throw new BadRequestException({
          code: INVENTORY_ERRORS.RECEIVE_OVER_ORDERED,
          message: `Line ${item.variantId} has only ${outstanding} unit(s) outstanding`,
          details: { itemId: line.itemId, outstanding, received: line.quantity },
        });
      }
    }

    if (lines.length === 0) {
      throw new BadRequestException({
        code: 'NOTHING_RECEIVED',
        message: 'Enter at least one received quantity',
      });
    }

    // Freight is charged once, on the first receipt, in proportion to line value. A
    // second partial receipt does not re-charge shipping the shop only paid once.
    const alreadyReceived = order.items.some((item) => item.receivedQuantity > 0);
    const extraToSpread = alreadyReceived ? 0n : order.shippingCost + order.otherCost;
    const lineValues = lines.map((line) => {
      const item = byId.get(line.itemId)!;
      return (line.unitCost ?? item.unitCost) * BigInt(line.quantity);
    });
    const allocations = allocateByValue(extraToSpread, lineValues);

    await this.prisma.$transaction(async (tx) => {
      for (const [index, line] of lines.entries()) {
        const item = byId.get(line.itemId)!;
        const unitCost = line.unitCost ?? item.unitCost;
        const landed = landedUnitCost({
          quantity: line.quantity,
          unitCostMinor: unitCost,
          landedExtraMinor: allocations[index] ?? 0n,
        });

        // Cost is re-averaged against every unit of that variant held anywhere, since
        // there is one costPrice per variant.
        const held = await tx.inventoryLevel.aggregate({
          where: { variantId: item.variantId },
          _sum: { onHand: true },
        });
        const variant = await tx.variant.findUniqueOrThrow({
          where: { id: item.variantId },
          select: { costPrice: true, productId: true },
        });

        const nextCost = weightedAverageCost(
          { quantity: held._sum.onHand ?? 0, unitCostMinor: variant.costPrice },
          { quantity: line.quantity, unitCostMinor: landed },
        );

        await this.ledger.postWithin(tx, {
          variantId: item.variantId,
          locationId: order.locationId,
          quantity: line.quantity,
          reason: StockMovementReason.PURCHASE,
          referenceType: 'purchase_order',
          referenceId: order.id,
          note: input.note ?? `Réception ${order.number}`,
          actorId,
        });
        await this.ledger.adjustIncomingWithin(tx, item.variantId, order.locationId, -line.quantity);

        await tx.variant.update({ where: { id: item.variantId }, data: { costPrice: nextCost } });
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: {
            receivedQuantity: item.receivedQuantity + line.quantity,
            ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
          },
        });
      }

      const refreshed = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
        select: { quantity: true, receivedQuantity: true },
      });
      const complete = refreshed.every((item) => item.receivedQuantity >= item.quantity);

      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: complete ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          receivedAt: complete ? new Date() : null,
        },
      });
    });

    await this.rollups.refreshProducts(
      order.items.map((item) => item.variant.product.id),
    );

    return this.get(id);
  }

  /** Cancels and gives back whatever `incoming` the order was holding. */
  async cancel(id: string): Promise<PurchaseOrderDto> {
    const order = await this.requireOrder(id);
    if (order.status === PurchaseOrderStatus.RECEIVED) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.PO_NOT_EDITABLE,
        message: 'A fully received purchase order cannot be cancelled',
        details: { status: order.status },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      if (order.status !== PurchaseOrderStatus.DRAFT) {
        for (const item of order.items) {
          const outstanding = item.quantity - item.receivedQuantity;
          if (outstanding > 0) {
            await this.ledger.adjustIncomingWithin(
              tx,
              item.variantId,
              order.locationId,
              -outstanding,
            );
          }
        }
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: PurchaseOrderStatus.CANCELLED },
      });
    });

    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const order = await this.requireOrder(id);
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.PO_NOT_EDITABLE,
        message: 'Only a draft purchase order can be deleted; cancel the others',
        details: { status: order.status },
      });
    }
    await this.prisma.purchaseOrder.delete({ where: { id } });
  }

  // --- helpers --------------------------------------------------------------

  private async requireOrder(id: string): Promise<PurchaseOrderRecord> {
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: INCLUDE });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Purchase order not found' });
    }
    return order;
  }

  private async assertVariantsExist(variantIds: string[]): Promise<void> {
    const unique = [...new Set(variantIds)];
    const found = await this.prisma.variant.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (found !== unique.length) {
      throw new BadRequestException({
        code: 'VARIANT_NOT_FOUND',
        message: 'One of the lines points at a variant that no longer exists',
      });
    }
  }

  /** `PO-2026-0007`: sortable, human-quotable on the phone to a supplier. */
  private async nextNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PO-${year}-`;
    const last = await this.prisma.purchaseOrder.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const sequence = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(sequence).padStart(4, '0')}`;
  }

  private buildWhere(
    query: AdminListQuery,
    filters: PurchaseOrderListFilters,
  ): Prisma.PurchaseOrderWhereInput {
    const term = query.q?.trim();
    return andWhere(
      filters.status?.length
        ? { status: { in: filters.status as Prisma.EnumPurchaseOrderStatusFilter['in'] } }
        : undefined,
      filters.supplierId?.length ? { supplierId: { in: filters.supplierId } } : undefined,
      filters.locationId?.length ? { locationId: { in: filters.locationId } } : undefined,
      term
        ? {
            OR: [
              { number: { contains: term, mode: 'insensitive' } },
              { supplier: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : undefined,
    ) as Prisma.PurchaseOrderWhereInput;
  }

  private toRow(row: PurchaseOrderRecord): PurchaseOrderRow {
    return {
      id: row.id,
      number: row.number,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      locationId: row.locationId,
      locationName: row.location.name,
      status: row.status as PurchaseOrderStatus,
      itemCount: row.items.length,
      quantityOrdered: row.items.reduce((sum, item) => sum + item.quantity, 0),
      quantityReceived: row.items.reduce((sum, item) => sum + item.receivedQuantity, 0),
      subtotal: row.subtotal.toString(),
      shippingCost: row.shippingCost.toString(),
      otherCost: row.otherCost.toString(),
      total: row.total.toString(),
      expectedAt: row.expectedAt?.toISOString() ?? null,
      orderedAt: row.orderedAt?.toISOString() ?? null,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDto(row: PurchaseOrderRecord): PurchaseOrderDto {
    return {
      ...this.toRow(row),
      note: row.note,
      items: row.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        sku: item.variant.sku,
        productId: item.variant.product.id,
        productName: item.variant.product.name as Translated,
        variantName: item.variant.name,
        imageUrl: this.storage.publicUrl(item.variant.product.media[0]?.media.storageKey),
        quantity: item.quantity,
        receivedQuantity: item.receivedQuantity,
        unitCost: item.unitCost.toString(),
        lineTotal: (item.unitCost * BigInt(item.quantity)).toString(),
      })),
    };
  }
}

export const PURCHASE_ORDER_EXPORT_COLUMNS: ExportColumn<PurchaseOrderRow>[] = [
  { header: 'Numéro', value: (row) => row.number, width: 16 },
  { header: 'Fournisseur', value: (row) => row.supplierName, width: 28 },
  { header: 'Emplacement', value: (row) => row.locationName, width: 18 },
  { header: 'Statut', value: (row) => row.status, width: 20 },
  { header: 'Lignes', value: (row) => row.itemCount },
  { header: 'Commandé', value: (row) => row.quantityOrdered },
  { header: 'Reçu', value: (row) => row.quantityReceived },
  { header: 'Sous-total (DA)', value: (row) => Number(row.subtotal) / 100 },
  { header: 'Total (DA)', value: (row) => Number(row.total) / 100 },
  { header: 'Attendu le', value: (row) => (row.expectedAt ? new Date(row.expectedAt) : '') },
  { header: 'Créé le', value: (row) => new Date(row.createdAt), width: 20 },
];
