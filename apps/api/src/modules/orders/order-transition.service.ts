import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import { OrderStatus, StockMovementReason, type OrderTransitionInput } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LocationsService } from '../inventory/locations.service.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { QueueService } from '../queue/queue.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  IllegalTransitionError,
  allowedFrom,
  effectsOf,
  type DeductionMoment,
} from './domain/state-machine.js';

/**
 * `OrderService.transition` — PRD F-AD-33.
 *
 * The single door every status change goes through, from the admin, from a courier
 * webhook, from a driver's phone. The pure state machine decides *what* should happen;
 * this applies it inside one transaction so an order can never end up with a new status
 * and unmoved stock, or moved stock and the old status.
 */

export interface TransitionActor {
  id: string | null;
  name: string;
}

@Injectable()
export class OrderTransitionService {
  private readonly logger = new Logger(OrderTransitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly locations: LocationsService,
    private readonly promotions: PromotionsService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
  ) {}

  async transition(
    orderId: string,
    input: OrderTransitionInput,
    actor: TransitionActor,
  ): Promise<{ id: string; number: string; status: OrderStatus }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { items: { select: { id: true, variantId: true, quantity: true } } },
    });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found' });

    const deductionMoment = (await this.settings.get<string>(
      'orders.stock_deduction_moment',
      'confirmed',
    )) as DeductionMoment;

    let effects;
    try {
      effects = effectsOf({
        from: order.status,
        to: input.to,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        deductionMoment,
        stockDeducted: order.stockDeducted,
        stockReserved: order.stockReserved,
        cashCollectedMinor: input.cashCollected,
        totalMinor: order.total,
        restock: (input.metadata?.restock as boolean | undefined) ?? true,
      });
    } catch (error) {
      if (error instanceof IllegalTransitionError) {
        throw new BadRequestException({
          code: 'ILLEGAL_TRANSITION',
          message: error.message,
          details: { from: order.status, to: input.to, allowed: allowedFrom(order.status) },
        });
      }
      throw error;
    }

    const locationId = await this.locations.defaultLocationId();

    await this.prisma.$transaction(async (tx) => {
      await this.applyStock(tx, order, effects.stock, locationId, actor.id);

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: input.to,
          paymentStatus: effects.paymentStatus,
          ...(effects.timestampField ? { [effects.timestampField]: new Date() } : {}),
          ...stockFlagsAfter(effects.stock, order),
          ...(input.to === OrderStatus.DELIVERED && input.cashCollected !== undefined
            ? { paidTotal: input.cashCollected }
            : {}),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          actorId: actor.id,
          fromStatus: order.status,
          toStatus: input.to,
          kind: 'status',
          reason: input.reason ?? null,
          metadata: {
            ...(input.metadata ?? {}),
            ...(input.failureReason ? { failureReason: input.failureReason } : {}),
            actor: actor.name,
          } as Prisma.InputJsonValue,
        },
      });

      if (effects.releasePromoUsage) {
        await this.promotions.releaseUsage(tx, order.id);
      }

      if (effects.refreshCustomerStats && order.customerId) {
        await refreshCustomerRollups(tx, order.customerId);
      }
    });

    this.announce(order, input.to, effects.notification);

    return { id: order.id, number: order.number, status: input.to };
  }

  /**
   * Moves the stock a transition calls for.
   *
   * Deducting also releases the reservation that covered it: without that the same
   * units are held *and* gone, and every subsequent availability check is wrong by the
   * size of the order.
   */
  private async applyStock(
    tx: Prisma.TransactionClient,
    order: { id: string; number: string; items: Array<{ variantId: string | null; quantity: number }> },
    effect: ReturnType<typeof effectsOf>['stock'],
    locationId: string,
    actorId: string | null,
  ): Promise<void> {
    if (effect === 'none') return;

    for (const item of order.items) {
      if (!item.variantId) continue;

      switch (effect) {
        case 'reserve':
          await this.ledger.reserveWithin(tx, item.variantId, locationId, item.quantity, {
            allowNegative: true,
          });
          break;

        case 'release':
          await this.ledger.reserveWithin(tx, item.variantId, locationId, -item.quantity);
          break;

        case 'deduct':
          await this.ledger.reserveWithin(tx, item.variantId, locationId, -item.quantity);
          await this.ledger.postWithin(tx, {
            variantId: item.variantId,
            locationId,
            quantity: -item.quantity,
            reason: StockMovementReason.SALE,
            referenceType: 'order',
            referenceId: order.id,
            note: order.number,
            actorId,
            // An oversell is a fact to record, not a write to refuse: the goods have
            // already been promised to a customer.
            allowNegative: true,
          });
          break;

        case 'restock':
          await this.ledger.postWithin(tx, {
            variantId: item.variantId,
            locationId,
            quantity: item.quantity,
            reason: StockMovementReason.RETURN,
            referenceType: 'order',
            referenceId: order.id,
            note: order.number,
            actorId,
          });
          break;
      }
    }
  }

  /** Realtime for the admin, and the customer's notification. Never throws. */
  private announce(
    order: { id: string; number: string; customerId: string | null },
    to: OrderStatus,
    event: string | null,
  ): void {
    this.realtime.emit(
      'order.transitioned',
      { orderId: order.id, number: order.number, status: to },
      ['orders.read'],
    );

    if (!event) return;

    void this.queue
      .enqueue('notifications', 'notification.dispatch', { event, orderId: order.id })
      .catch((error: unknown) => {
        this.logger.warn(`Could not queue ${event} for ${order.number}: ${String(error)}`);
      });
  }
}

/** Which of the two stock flags the order carries after a transition. */
function stockFlagsAfter(
  effect: ReturnType<typeof effectsOf>['stock'],
  order: { stockReserved: boolean; stockDeducted: boolean },
): { stockReserved?: boolean; stockDeducted?: boolean } {
  switch (effect) {
    case 'reserve':
      return { stockReserved: true };
    case 'release':
      return { stockReserved: false };
    case 'deduct':
      return { stockReserved: false, stockDeducted: true };
    case 'restock':
      return { stockReserved: false, stockDeducted: false };
    default:
      return { stockReserved: order.stockReserved, stockDeducted: order.stockDeducted };
  }
}

/**
 * Recomputes a customer's lifetime figures from their orders.
 *
 * A full recount rather than an increment: an increment drifts the first time a
 * transition is replayed or an order is edited, and this runs a handful of times a day
 * per customer at most.
 */
export async function refreshCustomerRollups(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const [counts, delivered] = await Promise.all([
    tx.order.groupBy({
      by: ['status'],
      where: { customerId, deletedAt: null },
      _count: { _all: true },
    }),
    tx.order.aggregate({
      where: { customerId, status: OrderStatus.DELIVERED, deletedAt: null },
      _sum: { total: true },
      _count: { _all: true },
      _max: { deliveredAt: true },
    }),
  ]);

  const countOf = (status: OrderStatus) =>
    counts.find((row) => row.status === status)?._count._all ?? 0;

  await tx.customer.update({
    where: { id: customerId },
    data: {
      ordersCount: counts.reduce((sum, row) => sum + row._count._all, 0),
      deliveredCount: delivered._count._all,
      failedCount: countOf(OrderStatus.FAILED) + countOf(OrderStatus.RETURNED),
      cancelledCount: countOf(OrderStatus.CANCELLED),
      // Lifetime value counts delivered orders only: an order that never arrived is
      // not revenue, however enthusiastically it was placed.
      lifetimeValue: delivered._sum.total ?? 0n,
    },
  });
}
