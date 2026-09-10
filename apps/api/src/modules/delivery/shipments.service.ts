import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DeliveryType,
  OrderStatus,
  ShipmentStatus,
  type DeliveryFailureReason,
  type Prisma,
} from '@jecks/db';
import {
  DELIVERY_ERRORS,
  t,
  type AdminListQuery,
  type CreateShipmentInput,
  type ShipmentDetail,
  type ShipmentRow,
  type ShipmentUpdateInput,
  type TrackingImportInput,
  type Translated,
} from '@jecks/shared';
import { renderLabels, type LabelData } from '../../common/pdf/delivery-documents.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { OrderTransitionService } from '../orders/order-transition.service.js';
import { CourierRegistry } from '../couriers/courier-registry.service.js';
import { ManualCourier } from '../couriers/manual.courier.js';
import type { CourierParcel, CourierTrackingUpdate } from '../couriers/courier-provider.js';

/**
 * Shipments — PRD F-AD-61.
 *
 * A shipment is the parcel's life outside the shop: created when it is handed over,
 * tracked while it moves, and closed when it is delivered or comes back. Everything that
 * changes an *order* still goes through the state machine; this service never writes an
 * order status itself, it asks for a transition and lets that refuse.
 */

/** Statuses that can be handed to a courier. Anything else is not a parcel yet. */
const SHIPPABLE: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.PACKED];

/** How a courier status maps onto an order status. */
const ORDER_STATUS_FOR: Partial<Record<ShipmentStatus, OrderStatus>> = {
  [ShipmentStatus.PICKED_UP]: OrderStatus.SHIPPED,
  [ShipmentStatus.IN_TRANSIT]: OrderStatus.SHIPPED,
  [ShipmentStatus.OUT_FOR_DELIVERY]: OrderStatus.OUT_FOR_DELIVERY,
  [ShipmentStatus.DELIVERED]: OrderStatus.DELIVERED,
  [ShipmentStatus.FAILED]: OrderStatus.FAILED,
  [ShipmentStatus.RETURNED]: OrderStatus.RETURNED,
};

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CourierRegistry,
    private readonly manual: ManualCourier,
    private readonly transitions: OrderTransitionService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // --- listing --------------------------------------------------------------

  async list(query: AdminListQuery, filters: Record<string, string[]>) {
    const where = this.whereFrom(query, filters);
    const [rows, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: { [query.sort ?? 'createdAt']: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: this.rowInclude(),
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toRow(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async listForExport(query: AdminListQuery, filters: Record<string, string[]>) {
    const rows = await this.prisma.shipment.findMany({
      where: this.whereFrom(query, filters),
      orderBy: { createdAt: 'desc' },
      take: 50_000,
      include: this.rowInclude(),
    });
    return rows.map((row) => this.toRow(row));
  }

  async get(id: string): Promise<ShipmentDetail> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        ...this.rowInclude(),
        events: { orderBy: { occurredAt: 'desc' }, take: 100 },
      },
    });
    if (!shipment) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Shipment not found' });

    return {
      ...this.toRow(shipment),
      events: shipment.events.map((event) => ({
        id: event.id,
        status: event.status,
        rawStatus: event.rawStatus,
        message: event.message,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  async counts(): Promise<Record<string, number>> {
    const grouped = await this.prisma.shipment.groupBy({ by: ['status'], _count: { _all: true } });
    const counts: Record<string, number> = { ALL: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }
    return counts;
  }

  // --- creating -------------------------------------------------------------

  /**
   * Hands a batch of orders to a courier or to one of our drivers.
   *
   * Each order is attempted independently and failures are reported per order rather
   * than rolling the batch back. Twenty parcels where one address is malformed should
   * ship nineteen, not none, and the operator needs to know which one to fix.
   */
  async create(
    input: CreateShipmentInput,
    actor: { id: string | null; name: string },
  ): Promise<{ created: string[]; failed: Array<{ orderId: string; message: string }> }> {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: input.orderIds }, deletedAt: null },
      include: {
        items: { select: { productName: true, quantity: true } },
        commune: { select: { nameAscii: true } },
        pickupPoint: { select: { id: true, name: true } },
      },
    });

    const courier = input.courierId
      ? await this.prisma.courier.findUnique({ where: { id: input.courierId } })
      : null;
    if (input.courierId && !courier) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Courier not found' });
    }

    const credentials = courier
      ? await this.registry.assertReady(courier.id, courier.provider)
      : {};
    const adapter = courier ? this.registry.adapterFor(courier.provider) : this.manual;

    const created: string[] = [];
    const failed: Array<{ orderId: string; message: string }> = [];

    for (const orderId of input.orderIds) {
      const order = orders.find((row) => row.id === orderId);
      if (!order) {
        failed.push({ orderId, message: 'Commande introuvable' });
        continue;
      }

      if (!SHIPPABLE.includes(order.status)) {
        failed.push({
          orderId,
          message: `La commande ${order.number} est en ${order.status} : elle doit être confirmée ou emballée.`,
        });
        continue;
      }

      const existing = await this.prisma.shipment.findFirst({
        where: {
          orderId,
          status: { notIn: [ShipmentStatus.CANCELLED, ShipmentStatus.RETURNED] },
        },
        select: { id: true },
      });
      if (existing) {
        failed.push({ orderId, message: `La commande ${order.number} a déjà une expédition.` });
        continue;
      }

      // What the courier must collect: the total less anything already paid. Snapshotted
      // now, so a later edit to the order cannot change what the driver was told.
      const codAmount =
        order.paymentStatus === 'PAID' ? 0n : bigMax(order.total - order.paidTotal, 0n);

      try {
        const parcel = this.toParcel(order, codAmount);
        const result = await adapter.createShipment(parcel, credentials);

        const shipment = await this.prisma.shipment.create({
          data: {
            orderId,
            courierId: courier?.id ?? null,
            driverId: input.driverId ?? null,
            status: result.status,
            trackingNumber: result.trackingNumber,
            trackingUrl: result.trackingUrl,
            codAmount,
            cost: result.costMinor ?? 0n,
            events: {
              create: {
                status: result.status,
                rawStatus: 'created',
                message: courier ? `Confié à ${courier.name}` : 'Confié à la flotte',
              },
            },
          },
        });

        created.push(shipment.id);

        // Handing a parcel over is what SHIPPED means; the machine decides if it may.
        if (order.status !== OrderStatus.SHIPPED) {
          await this.transitions
            .transition(orderId, { to: OrderStatus.SHIPPED, reason: 'Expédition créée' }, actor)
            .catch((error: Error) => {
              // The parcel is real even if the order refuses to move; log and carry on
              // rather than leaving a shipment nobody knows about.
              this.logger.warn(`Order ${order.number} would not move to SHIPPED: ${error.message}`);
            });
        }
      } catch (error) {
        failed.push({ orderId, message: (error as Error).message });
      }
    }

    return { created, failed };
  }

  async update(id: string, input: ShipmentUpdateInput): Promise<ShipmentDetail> {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Shipment not found' });

    await this.prisma.shipment.update({
      where: { id },
      data: {
        ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
        ...(input.trackingUrl === undefined ? {} : { trackingUrl: input.trackingUrl }),
        ...(input.cost === undefined ? {} : { cost: input.cost }),
        ...(input.note
          ? { events: { create: { status: shipment.status, rawStatus: 'note', message: input.note } } }
          : {}),
      },
    });

    return this.get(id);
  }

  /**
   * Cancels a parcel, telling the courier when they support it.
   *
   * A delivered parcel cannot be cancelled: the money has changed hands, and the way
   * back from there is a return, which is a different thing with different accounting.
   */
  async cancel(id: string): Promise<ShipmentDetail> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { courier: true },
    });
    if (!shipment) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Shipment not found' });

    if (shipment.status === ShipmentStatus.DELIVERED) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.SHIPMENT_NOT_CANCELLABLE,
        message: 'Un colis livré ne s’annule pas ; enregistrez un retour.',
      });
    }

    if (shipment.courier && shipment.trackingNumber) {
      const adapter = this.registry.adapterFor(shipment.courier.provider);
      if (adapter.supportsCancel) {
        const credentials = await this.registry.credentialsFor(shipment.courier.id);
        await adapter.cancel(shipment.trackingNumber, credentials).catch((error: Error) => {
          this.logger.warn(`Courier refused the cancellation: ${error.message}`);
        });
      }
    }

    await this.prisma.shipment.update({
      where: { id },
      data: {
        status: ShipmentStatus.CANCELLED,
        events: { create: { status: ShipmentStatus.CANCELLED, rawStatus: 'cancelled' } },
      },
    });

    return this.get(id);
  }

  // --- labels ---------------------------------------------------------------

  /**
   * The label PDF for a batch of shipments.
   *
   * The courier's own label is preferred when they have one, because their sorting
   * centres scan their barcode. Otherwise the platform prints its own, which is what
   * every manual-courier shop uses.
   */
  async labels(shipmentIds: string[]): Promise<Buffer> {
    const shipments = await this.prisma.shipment.findMany({
      where: { id: { in: shipmentIds } },
      include: {
        courier: { select: { name: true } },
        order: {
          include: {
            commune: { select: { nameAscii: true } },
            pickupPoint: { select: { name: true } },
          },
        },
      },
    });

    if (shipments.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No shipment to label' });
    }

    const shopName = await this.settings.get<string>('shop.name', "Jeck's");
    const shopPhone = await this.settings.get<string | null>('shop.phone', null);

    const labels: LabelData[] = shipments.map((shipment) => ({
      orderNumber: shipment.order.number,
      trackingNumber: shipment.trackingNumber,
      shopName,
      shopPhone,
      customerName: shipment.order.customerName,
      customerPhone: shipment.order.customerPhone,
      altPhone: shipment.order.customerAltPhone,
      address: shipment.order.address,
      communeName: shipment.order.communeName ?? shipment.order.commune?.nameAscii ?? null,
      wilayaCode: shipment.order.wilayaCode,
      wilayaName: shipment.order.wilayaName,
      isStopDesk: shipment.order.deliveryType === DeliveryType.STOP_DESK,
      pickupPointName: shipment.order.pickupPoint?.name ?? null,
      codAmountMinor: shipment.codAmount,
      itemCount: shipment.order.itemCount,
      weightGrams: shipment.order.weightGrams,
      courierName: shipment.courier?.name ?? null,
      note: shipment.order.note,
      printedAt: new Date(),
    }));

    const pdf = renderLabels(labels);

    // Stored so a reprint costs nothing and an audit can see what was actually printed.
    if (shipments.length === 1) {
      const key = `labels/${shipments[0]!.order.number}.pdf`;
      await this.storage.put(key, pdf).catch((error: Error) => {
        this.logger.warn(`Could not store the label: ${error.message}`);
      });
      await this.prisma.shipment.update({ where: { id: shipments[0]!.id }, data: { labelKey: key } });
    }

    return pdf;
  }

  // --- tracking -------------------------------------------------------------

  /**
   * Applies a tracking update from a webhook, a poll or an import.
   *
   * One door for all three. It is idempotent: an update that does not change the status
   * records nothing, so a courier that resends the same event fifty times leaves fifty
   * nothing-happened and one event row.
   */
  async applyUpdate(
    update: CourierTrackingUpdate,
    actor: { id: string | null; name: string },
  ): Promise<'applied' | 'ignored' | 'unknown'> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { trackingNumber: update.trackingNumber },
      include: { order: { select: { id: true, number: true, status: true, total: true } } },
    });

    if (!shipment) return 'unknown';
    if (shipment.status === update.status) return 'ignored';

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: update.status,
        failureReason: update.failureReason,
        attempts:
          update.status === ShipmentStatus.FAILED ? { increment: 1 } : undefined,
        shippedAt:
          shipment.shippedAt ??
          (update.status === ShipmentStatus.PICKED_UP || update.status === ShipmentStatus.IN_TRANSIT
            ? update.occurredAt
            : null),
        deliveredAt: update.status === ShipmentStatus.DELIVERED ? update.occurredAt : shipment.deliveredAt,
        events: {
          create: {
            status: update.status,
            rawStatus: update.rawStatus,
            message: update.message,
            occurredAt: update.occurredAt,
          },
        },
      },
    });

    const nextOrderStatus = ORDER_STATUS_FOR[update.status];
    if (nextOrderStatus && nextOrderStatus !== shipment.order.status) {
      // The cash the courier reports, or the whole COD when they only say "delivered".
      const cashCollected =
        update.status === ShipmentStatus.DELIVERED
          ? (update.codCollectedMinor ?? shipment.codAmount)
          : undefined;

      await this.transitions
        .transition(
          shipment.orderId,
          {
            to: nextOrderStatus,
            reason: `Transporteur : ${update.rawStatus}`,
            failureReason: update.failureReason ?? undefined,
            ...(cashCollected === undefined ? {} : { cashCollected }),
          },
          actor,
        )
        .catch((error: Error) => {
          this.logger.warn(
            `Order ${shipment.order.number} would not move to ${nextOrderStatus}: ${error.message}`,
          );
        });

      if (update.status === ShipmentStatus.DELIVERED && shipment.codAmount > 0n) {
        await this.recordCodCollection(shipment.id, shipment.orderId, shipment.courierId, cashCollected ?? shipment.codAmount, update.occurredAt);
      }
    }

    return 'applied';
  }

  /**
   * Records cash a courier collected on our behalf.
   *
   * Written once per shipment: a courier that reports "delivered" twice must not create
   * two collections, or the settlement will expect twice the money.
   */
  private async recordCodCollection(
    shipmentId: string,
    orderId: string,
    courierId: string | null,
    amount: bigint,
    collectedAt: Date,
  ): Promise<void> {
    const existing = await this.prisma.codCollection.findFirst({
      where: { orderId, courierId },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.codCollection.create({
      data: {
        orderId,
        courierId,
        amount,
        collectedAt,
        note: `Encaissé par le transporteur (expédition ${shipmentId.slice(0, 8)})`,
      },
    });
  }

  /**
   * The spreadsheet a manual courier hands back.
   *
   * Rows are matched by order number rather than by tracking number, because the
   * tracking number is exactly what the shop does not have yet.
   */
  async importTracking(
    input: TrackingImportInput,
    actor: { id: string | null; name: string },
  ): Promise<{ matched: number; updated: number; unmatched: string[] }> {
    const numbers = input.rows.map((row) => row.orderNumber);
    const orders = await this.prisma.order.findMany({
      where: { number: { in: numbers } },
      select: { id: true, number: true },
    });

    const byNumber = new Map(orders.map((order) => [order.number, order.id]));
    const unmatched: string[] = [];
    let matched = 0;
    let updated = 0;

    for (const row of input.rows) {
      const orderId = byNumber.get(row.orderNumber);
      if (!orderId) {
        unmatched.push(row.orderNumber);
        continue;
      }

      const shipment = await this.prisma.shipment.findFirst({
        where: { orderId, status: { not: ShipmentStatus.CANCELLED } },
        orderBy: { createdAt: 'desc' },
      });
      if (!shipment) {
        unmatched.push(row.orderNumber);
        continue;
      }

      matched += 1;
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          trackingNumber: row.trackingNumber,
          ...(row.cost === undefined ? {} : { cost: row.cost }),
        },
      });

      if (row.status) {
        const result = await this.applyUpdate(
          this.manual.fromImport({ trackingNumber: row.trackingNumber, status: row.status }),
          actor,
        );
        if (result === 'applied') updated += 1;
      }
    }

    return { matched, updated, unmatched };
  }

  /** Shipments still moving with a given courier, for the sync job. */
  async openTrackingNumbers(courierId: string, limit = 200): Promise<string[]> {
    const rows = await this.prisma.shipment.findMany({
      where: {
        courierId,
        trackingNumber: { not: null },
        status: {
          in: [
            ShipmentStatus.CREATED,
            ShipmentStatus.PICKED_UP,
            ShipmentStatus.IN_TRANSIT,
            ShipmentStatus.OUT_FOR_DELIVERY,
          ],
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { trackingNumber: true },
    });

    return rows.map((row) => row.trackingNumber!).filter(Boolean);
  }

  // --- helpers --------------------------------------------------------------

  private toParcel(
    order: {
      id: string;
      number: string;
      customerName: string;
      customerPhone: string;
      customerAltPhone: string | null;
      address: string | null;
      wilayaCode: number;
      wilayaName: string;
      communeName: string | null;
      commune: { nameAscii: string } | null;
      pickupPoint: { id: string; name: string } | null;
      deliveryType: DeliveryType;
      weightGrams: number;
      itemCount: number;
      note: string | null;
      items: Array<{ productName: unknown; quantity: number }>;
    },
    codAmount: bigint,
  ): CourierParcel {
    const contents = order.items
      .map((item) => `${t(item.productName as Translated, 'fr')} x${item.quantity}`)
      .join(', ')
      .slice(0, 250);

    return {
      orderId: order.id,
      orderNumber: order.number,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      altPhone: order.customerAltPhone,
      address: order.address,
      wilayaCode: order.wilayaCode,
      wilayaName: order.wilayaName,
      communeName: order.communeName ?? order.commune?.nameAscii ?? null,
      pickupPointCode: order.pickupPoint?.id ?? null,
      isStopDesk: order.deliveryType === DeliveryType.STOP_DESK,
      codAmountMinor: codAmount,
      weightGrams: order.weightGrams,
      itemCount: order.itemCount,
      contents: contents || 'Articles',
      note: order.note,
    };
  }

  private whereFrom(query: AdminListQuery, filters: Record<string, string[]>): Prisma.ShipmentWhereInput {
    const search = query.q?.trim();

    return {
      ...(filters.status?.length ? { status: { in: filters.status as ShipmentStatus[] } } : {}),
      ...(filters.courierId?.length ? { courierId: { in: filters.courierId } } : {}),
      ...(filters.driverId?.length ? { driverId: { in: filters.driverId } } : {}),
      ...(filters.wilayaCode?.length
        ? { order: { wilayaCode: { in: filters.wilayaCode.map(Number) } } }
        : {}),
      ...(search
        ? {
            OR: [
              { trackingNumber: { contains: search, mode: 'insensitive' } },
              { order: { number: { contains: search, mode: 'insensitive' } } },
              { order: { customerPhone: { contains: search } } },
              { order: { customerName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private rowInclude() {
    return {
      courier: { select: { id: true, name: true } },
      driver: { select: { id: true, user: { select: { name: true } } } },
      order: {
        select: {
          id: true,
          number: true,
          customerName: true,
          customerPhone: true,
          wilayaName: true,
          communeName: true,
          deliveryType: true,
        },
      },
    } satisfies Prisma.ShipmentInclude;
  }

  private toRow(shipment: {
    id: string;
    orderId: string;
    status: ShipmentStatus;
    trackingNumber: string | null;
    trackingUrl: string | null;
    labelKey: string | null;
    attempts: number;
    cost: bigint;
    codAmount: bigint;
    failureReason: DeliveryFailureReason | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    createdAt: Date;
    courier: { id: string; name: string } | null;
    driver: { id: string; user: { name: string } } | null;
    order: {
      number: string;
      customerName: string;
      customerPhone: string;
      wilayaName: string;
      communeName: string | null;
      deliveryType: DeliveryType;
    };
  }): ShipmentRow {
    return {
      id: shipment.id,
      orderId: shipment.orderId,
      orderNumber: shipment.order.number,
      customerName: shipment.order.customerName,
      customerPhone: shipment.order.customerPhone,
      wilayaName: shipment.order.wilayaName,
      communeName: shipment.order.communeName,
      deliveryType: shipment.order.deliveryType,
      status: shipment.status,
      courierId: shipment.courier?.id ?? null,
      courierName: shipment.courier?.name ?? null,
      driverId: shipment.driver?.id ?? null,
      driverName: shipment.driver?.user.name ?? null,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      hasLabel: Boolean(shipment.labelKey),
      attempts: shipment.attempts,
      costMinor: shipment.cost.toString(),
      codAmountMinor: shipment.codAmount.toString(),
      failureReason: shipment.failureReason,
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      createdAt: shipment.createdAt.toISOString(),
    };
  }
}

function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export const SHIPMENT_EXPORT_COLUMNS = [
  { header: 'Commande', value: (row: ShipmentRow) => row.orderNumber },
  { header: 'Client', value: (row: ShipmentRow) => row.customerName },
  { header: 'Téléphone', value: (row: ShipmentRow) => row.customerPhone },
  { header: 'Wilaya', value: (row: ShipmentRow) => row.wilayaName },
  { header: 'Transporteur', value: (row: ShipmentRow) => row.courierName ?? row.driverName ?? '' },
  { header: 'Suivi', value: (row: ShipmentRow) => row.trackingNumber ?? '' },
  { header: 'Statut', value: (row: ShipmentRow) => row.status },
  { header: 'Tentatives', value: (row: ShipmentRow) => row.attempts },
  { header: 'À encaisser (DA)', value: (row: ShipmentRow) => Number(row.codAmountMinor) / 100 },
  { header: 'Coût (DA)', value: (row: ShipmentRow) => Number(row.costMinor) / 100 },
  { header: 'Livré le', value: (row: ShipmentRow) => row.deliveredAt ?? '' },
];
