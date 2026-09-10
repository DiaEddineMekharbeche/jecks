import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  ORDER_ERRORS,
  OrderStatus,
  t,
  type CallLogInput,
  type OrderAddressPatchInput,
  type OrderBulkInput,
  type OrderBulkResult,
  type OrderDetail,
  type OrderNoteInput,
  type OrderTagsInput,
  type OrderTransitionInput,
  type RiskFlag,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { allowedFrom, isEditable } from './domain/state-machine.js';
import { OrderTransitionService, type TransitionActor } from './order-transition.service.js';

/**
 * The order detail an agent works from — PRD F-AD-30 to F-AD-36.
 *
 * Reads and the small writes that are not status changes: notes, tags, call logs, the
 * address. Every status change goes through `OrderTransitionService` instead, so there
 * is exactly one place that knows what a transition means.
 */

const DETAIL_INCLUDE = {
  customer: {
    select: { id: true, ordersCount: true, deliveredCount: true, failedCount: true },
  },
  agent: { select: { name: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        select: {
          id: true,
          productId: true,
          product: { select: { slug: true } },
          inventoryLevels: { select: { onHand: true, reserved: true } },
        },
      },
    },
  },
  events: {
    orderBy: { createdAt: 'desc' as const },
    take: 100,
    include: { actor: { select: { name: true } } },
  },
  notes: {
    orderBy: { createdAt: 'desc' as const },
    include: { author: { select: { name: true } } },
  },
  callLogs: {
    orderBy: { createdAt: 'desc' as const },
    include: { agent: { select: { name: true } } },
  },
  shipments: {
    orderBy: { createdAt: 'desc' as const },
    include: { courier: { select: { name: true } } },
  },
} satisfies Prisma.OrderInclude;

type OrderRecord = Prisma.OrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;

@Injectable()
export class OrdersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
    private readonly storage: StorageService,
  ) {}

  async get(id: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found' });
    return this.toDetail(order);
  }

  async getByNumber(number: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { number, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found' });
    return this.toDetail(order);
  }

  /** Row counts per status, for the list's tabs. */
  async counts(): Promise<Record<string, number>> {
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });

    const out: Record<string, number> = { ALL: 0 };
    for (const group of grouped) {
      out[group.status] = group._count._all;
      out.ALL += group._count._all;
    }
    return out;
  }

  async transition(
    id: string,
    input: OrderTransitionInput,
    actor: TransitionActor,
  ): Promise<OrderDetail> {
    await this.transitions.transition(id, input, actor);
    return this.get(id);
  }

  /**
   * Applies one action to a selection — PRD F-AD-30.
   *
   * Each order is transitioned on its own, and a refusal is reported rather than
   * aborting the batch: an agent confirming forty orders should not lose thirty-nine
   * of them because one was already cancelled.
   */
  async bulk(input: OrderBulkInput, actor: TransitionActor): Promise<OrderBulkResult> {
    const target: Record<OrderBulkInput['action'], OrderStatus> = {
      confirm: OrderStatus.CONFIRMED,
      pack: OrderStatus.PACKED,
      ship: OrderStatus.SHIPPED,
      cancel: OrderStatus.CANCELLED,
    };

    const orders = await this.prisma.order.findMany({
      where: { id: { in: input.ids }, deletedAt: null },
      select: { id: true, number: true },
    });

    const failed: OrderBulkResult['failed'] = [];
    let updated = 0;

    for (const order of orders) {
      try {
        await this.transitions.transition(
          order.id,
          { to: target[input.action], reason: input.reason },
          actor,
        );
        updated += 1;
      } catch (error) {
        failed.push({
          id: order.id,
          number: order.number,
          message: messageOf(error),
        });
      }
    }

    return { updated, failed };
  }

  // --- the small writes -----------------------------------------------------

  async addNote(id: string, input: OrderNoteInput, actor: TransitionActor): Promise<OrderDetail> {
    await this.prisma.orderNote.create({
      data: { orderId: id, body: input.body, authorId: actor.id },
    });
    return this.get(id);
  }

  async setTags(id: string, input: OrderTagsInput): Promise<OrderDetail> {
    await this.prisma.order.update({
      where: { id },
      data: { tags: [...new Set(input.tags)] },
    });
    return this.get(id);
  }

  /**
   * Records a call — PRD F-AD-34.
   *
   * A callback time is stored with the log rather than as a task elsewhere: the agent
   * who promised to call back at four is the agent looking at this order.
   */
  async logCall(id: string, input: CallLogInput, actor: TransitionActor): Promise<OrderDetail> {
    await this.prisma.callLog.create({
      data: {
        orderId: id,
        agentId: actor.id,
        outcome: input.outcome,
        note: input.note ?? null,
        callBackAt: input.callBackAt ?? null,
      },
    });

    // The call itself is part of the order's history, not a separate log an agent has
    // to remember to open.
    await this.prisma.orderEvent.create({
      data: {
        orderId: id,
        actorId: actor.id,
        kind: 'call',
        reason: `${input.outcome}${input.note ? ` — ${input.note}` : ''}`,
      },
    });

    return this.get(id);
  }

  /**
   * Edits the customer and delivery details of an order that has not been packed.
   *
   * Wrong phone numbers and vague addresses are the two commonest causes of a failed
   * COD delivery, and an agent fixes both on the telephone. After PACKED the label is
   * printed and the parcel is physical, so the edit is refused.
   */
  async updateAddress(
    id: string,
    input: OrderAddressPatchInput,
    actor: TransitionActor,
  ): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, wilayaCode: true },
    });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found' });

    if (!isEditable(order.status)) {
      throw new ConflictException({
        code: ORDER_ERRORS.NOT_EDITABLE,
        message: `A ${order.status.toLowerCase()} order can no longer be edited`,
        details: { status: order.status },
      });
    }

    const wilayaCode = input.wilayaCode ?? order.wilayaCode;
    let communeName: string | undefined;

    if (input.communeId) {
      const commune = await this.prisma.commune.findFirst({
        where: { id: input.communeId, wilayaCode },
        select: { name: true },
      });
      if (!commune) {
        throw new BadRequestException({
          code: ORDER_ERRORS.COMMUNE_MISMATCH,
          message: 'That commune does not belong to the chosen wilaya',
          details: { field: 'communeId' },
        });
      }
      communeName = t(commune.name as Translated, 'fr');
    }

    const wilaya =
      input.wilayaCode !== undefined
        ? await this.prisma.wilaya.findUnique({
            where: { code: input.wilayaCode },
            select: { name: true },
          })
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAltPhone: input.customerAltPhone,
          wilayaCode: input.wilayaCode,
          ...(wilaya ? { wilayaName: t(wilaya.name as Translated, 'fr') } : {}),
          communeId: input.communeId,
          ...(communeName ? { communeName } : {}),
          address: input.address,
          pickupPointId: input.pickupPointId,
          note: input.note,
          internalNote: input.internalNote,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: id,
          actorId: actor.id,
          kind: 'edit',
          reason: 'Coordonnées mises à jour',
          metadata: input as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return this.get(id);
  }

  /** Assigns the order to the agent handling it, so a queue can be divided. */
  async assign(id: string, agentId: string | null): Promise<OrderDetail> {
    await this.prisma.order.update({ where: { id }, data: { agentId } });
    return this.get(id);
  }

  // --- shaping --------------------------------------------------------------

  private toDetail(order: OrderRecord): OrderDetail {
    const margin = order.total - order.cogsTotal - order.shippingCost;

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      source: order.source,

      customerId: order.customerId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAltPhone: order.customerAltPhone,
      customerEmail: order.customerEmail,
      customerOrdersCount: order.customer?.ordersCount ?? 0,
      customerDeliveredCount: order.customer?.deliveredCount ?? 0,
      customerFailedCount: order.customer?.failedCount ?? 0,

      wilayaCode: order.wilayaCode,
      wilayaName: order.wilayaName,
      communeName: order.communeName,
      deliveryType: order.deliveryType,
      address: order.address,
      pickupPointName: order.pickupPointName,

      currency: order.currency,
      itemsSubtotalMinor: order.itemsSubtotal.toString(),
      discountTotalMinor: order.discountTotal.toString(),
      loyaltyDiscountMinor: order.loyaltyDiscount.toString(),
      shippingTotalMinor: order.shippingTotal.toString(),
      shippingCostMinor: order.shippingCost.toString(),
      taxTotalMinor: order.taxTotal.toString(),
      totalMinor: order.total.toString(),
      cogsTotalMinor: order.cogsTotal.toString(),
      paidTotalMinor: order.paidTotal.toString(),
      refundedTotalMinor: order.refundedTotal.toString(),
      marginMinor: margin.toString(),

      itemCount: order.itemCount,
      weightGrams: order.weightGrams,
      note: order.note,
      internalNote: order.internalNote,
      tags: order.tags,
      riskScore: order.riskScore,
      riskFlags: ((order.riskFlags ?? []) as RiskFlag[]) ?? [],
      stockReserved: order.stockReserved,
      stockDeducted: order.stockDeducted,

      agentName: order.agent?.name ?? null,
      allowedTransitions: allowedFrom(order.status),
      editable: isEditable(order.status),

      items: order.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        productId: item.variant?.productId ?? null,
        productName: item.productName as Translated,
        productSlug: item.variant?.product.slug ?? null,
        variantName: item.variantName,
        sku: item.sku,
        imageUrl: this.storage.publicUrl(item.mediaKey),
        quantity: item.quantity,
        unitPriceMinor: item.unitPrice.toString(),
        unitCostMinor: item.unitCost.toString(),
        discountMinor: item.discountAmount.toString(),
        lineTotalMinor: item.lineTotal.toString(),
        refundedQuantity: item.refundedQuantity,
        returnedQuantity: item.returnedQuantity,
        available: (item.variant?.inventoryLevels ?? []).reduce(
          (sum, level) => sum + Math.max(level.onHand - level.reserved, 0),
          0,
        ),
      })),

      events: order.events.map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        kind: event.kind,
        reason: event.reason,
        actorName: event.actor?.name ?? null,
        metadata: (event.metadata ?? null) as Record<string, unknown> | null,
        createdAt: event.createdAt.toISOString(),
      })),

      notes: order.notes.map((note) => ({
        id: note.id,
        body: note.body,
        authorName: note.author?.name ?? null,
        createdAt: note.createdAt.toISOString(),
      })),

      callLogs: order.callLogs.map((log) => ({
        id: log.id,
        outcome: log.outcome,
        note: log.note,
        callBackAt: log.callBackAt?.toISOString() ?? null,
        agentName: log.agent?.name ?? null,
        createdAt: log.createdAt.toISOString(),
      })),

      shipments: order.shipments.map((shipment) => ({
        id: shipment.id,
        status: shipment.status,
        courierName: shipment.courier?.name ?? null,
        trackingNumber: shipment.trackingNumber,
        createdAt: shipment.createdAt.toISOString(),
      })),

      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { message?: string } }).response;
    if (response?.message) return response.message;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}
