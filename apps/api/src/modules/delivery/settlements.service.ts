import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus, type SettlementStatus } from '@jecks/db';
import {
  DELIVERY_ERRORS,
  type SettlementDto,
  type SettlementGenerateInput,
  type SettlementLineDto,
  type SettlementPayInput,
  type SettlementStatusValue,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buildSettlement, settlementDifference } from './domain/settlement.js';

/**
 * Courier settlements — PRD F-AD-64.
 *
 * A settlement is our claim against a courier for a period: every parcel they delivered,
 * the cash they collected, the fees they keep, and what is left for them to pay us.
 *
 * The arithmetic is pure and lives in `domain/settlement`. This service only decides
 * which parcels belong in the period and records what was actually paid.
 */
@Injectable()
export class SettlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { courierId?: string; status?: string[] } = {}): Promise<SettlementDto[]> {
    const settlements = await this.prisma.courierSettlement.findMany({
      where: {
        ...(filters.courierId ? { courierId: filters.courierId } : {}),
        ...(filters.status?.length ? { status: { in: filters.status as SettlementStatus[] } } : {}),
      },
      orderBy: { periodTo: 'desc' },
      take: 200,
      include: { courier: { select: { name: true } }, _count: { select: { lines: true } } },
    });

    return settlements.map((settlement) => this.toDto(settlement, settlement._count.lines));
  }

  async get(id: string): Promise<SettlementDto> {
    const settlement = await this.prisma.courierSettlement.findUnique({
      where: { id },
      include: {
        courier: { select: { name: true } },
        lines: {
          orderBy: { orderId: 'asc' },
          include: { order: { select: { number: true, deliveredAt: true } } },
        },
      },
    });
    if (!settlement) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Settlement not found' });

    const lines: SettlementLineDto[] = settlement.lines.map((line) => ({
      id: line.id,
      orderId: line.orderId,
      orderNumber: line.order.number,
      deliveredAt: line.order.deliveredAt?.toISOString() ?? null,
      codAmountMinor: line.codAmount.toString(),
      feeAmountMinor: line.feeAmount.toString(),
      netAmountMinor: line.netAmount.toString(),
      note: line.note,
    }));

    return { ...this.toDto(settlement, lines.length), lines };
  }

  /**
   * Builds a settlement for a courier and a period.
   *
   * A parcel already on another settlement is skipped rather than counted twice, which
   * is what makes it safe to regenerate an overlapping period after a late delivery
   * lands. An empty result is refused: a settlement with no lines is a document that
   * looks like a claim and is not one.
   */
  async generate(input: SettlementGenerateInput): Promise<SettlementDto> {
    const courier = await this.prisma.courier.findUnique({ where: { id: input.courierId } });
    if (!courier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Courier not found' });

    const from = startOfDay(input.from);
    const to = new Date(startOfDay(input.to).getTime() + 86_400_000);

    const alreadySettled = await this.prisma.courierSettlementLine.findMany({
      where: { settlement: { courierId: courier.id } },
      select: { orderId: true },
    });
    const settledIds = new Set(alreadySettled.map((line) => line.orderId));

    const shipments = await this.prisma.shipment.findMany({
      where: {
        courierId: courier.id,
        status: ShipmentStatus.DELIVERED,
        deliveredAt: { gte: from, lt: to },
        order: { status: OrderStatus.DELIVERED },
      },
      select: { orderId: true, codAmount: true, cost: true, order: { select: { shippingCost: true } } },
    });

    const candidates = shipments
      .filter((shipment) => !settledIds.has(shipment.orderId))
      .map((shipment) => ({
        orderId: shipment.orderId,
        codAmountMinor: shipment.codAmount,
        // The shipment's own cost when the courier quoted one; otherwise what the order
        // recorded at the time it shipped.
        shippingCostMinor: shipment.cost > 0n ? shipment.cost : shipment.order.shippingCost,
      }));

    if (candidates.length === 0) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.SETTLEMENT_EMPTY,
        message: 'Aucun colis livré et non réglé sur cette période.',
      });
    }

    const totals = buildSettlement(candidates, Number(courier.codFeePercent));
    const reference = await this.nextReference(courier.slug, to);

    const settlement = await this.prisma.courierSettlement.create({
      data: {
        courierId: courier.id,
        reference,
        periodFrom: from,
        periodTo: startOfDay(input.to),
        grossAmount: totals.grossMinor,
        feesAmount: totals.feesMinor,
        netAmount: totals.netMinor,
        difference: totals.netMinor,
        lines: {
          create: totals.lines.map((line) => ({
            orderId: line.orderId,
            codAmount: line.codAmountMinor,
            feeAmount: line.feeAmountMinor,
            netAmount: line.netAmountMinor,
          })),
        },
      },
    });

    return this.get(settlement.id);
  }

  async setStatus(id: string, status: SettlementStatusValue): Promise<SettlementDto> {
    const settlement = await this.prisma.courierSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Settlement not found' });

    await this.prisma.courierSettlement.update({ where: { id }, data: { status } });
    return this.get(id);
  }

  /**
   * Records a payment against a settlement.
   *
   * The difference is kept rather than zeroed: a courier who pays 4 000 short has not
   * settled, and the number that says so is the only thing that will get it chased.
   */
  async pay(id: string, input: SettlementPayInput): Promise<SettlementDto> {
    const settlement = await this.prisma.courierSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Settlement not found' });

    if (settlement.status === 'PAID' && settlement.difference === 0n) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.SETTLEMENT_LOCKED,
        message: 'Ce règlement est déjà soldé.',
      });
    }

    const paid = settlement.paidAmount + input.paidAmount;
    const difference = settlementDifference(settlement.netAmount, paid);

    await this.prisma.courierSettlement.update({
      where: { id },
      data: {
        paidAmount: paid,
        difference,
        paidAt: input.paidAt ?? new Date(),
        status: difference === 0n ? 'PAID' : 'DISPUTED',
        ...(input.note ? { note: input.note } : {}),
      },
    });

    // Cash the courier was holding has now landed, so it stops being outstanding.
    const orderIds = await this.prisma.courierSettlementLine.findMany({
      where: { settlementId: id },
      select: { orderId: true },
    });

    await this.prisma.codCollection.updateMany({
      where: {
        orderId: { in: orderIds.map((line) => line.orderId) },
        courierId: settlement.courierId,
        reconciledAt: null,
      },
      data: { reconciledAt: input.paidAt ?? new Date() },
    });

    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const settlement = await this.prisma.courierSettlement.findUnique({ where: { id } });
    if (!settlement) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Settlement not found' });

    if (settlement.paidAmount > 0n) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.SETTLEMENT_LOCKED,
        message: 'Un règlement déjà encaissé ne se supprime pas.',
      });
    }

    await this.prisma.courierSettlement.delete({ where: { id } });
  }

  private async nextReference(slug: string, to: Date): Promise<string> {
    const stamp = to.toISOString().slice(0, 7).replace('-', '');
    const count = await this.prisma.courierSettlement.count({
      where: { reference: { startsWith: `RGL-${slug.toUpperCase()}-${stamp}` } },
    });
    return `RGL-${slug.toUpperCase()}-${stamp}-${count + 1}`;
  }

  private toDto(
    settlement: {
      id: string;
      reference: string;
      courierId: string;
      periodFrom: Date;
      periodTo: Date;
      status: SettlementStatus;
      grossAmount: bigint;
      feesAmount: bigint;
      netAmount: bigint;
      paidAmount: bigint;
      difference: bigint;
      paidAt: Date | null;
      note: string | null;
      courier: { name: string };
    },
    lineCount: number,
  ): SettlementDto {
    return {
      id: settlement.id,
      reference: settlement.reference,
      courierId: settlement.courierId,
      courierName: settlement.courier.name,
      periodFrom: settlement.periodFrom.toISOString().slice(0, 10),
      periodTo: settlement.periodTo.toISOString().slice(0, 10),
      status: settlement.status as SettlementStatusValue,
      grossAmountMinor: settlement.grossAmount.toString(),
      feesAmountMinor: settlement.feesAmount.toString(),
      netAmountMinor: settlement.netAmount.toString(),
      paidAmountMinor: settlement.paidAmount.toString(),
      differenceMinor: settlement.difference.toString(),
      paidAt: settlement.paidAt?.toISOString() ?? null,
      note: settlement.note,
      lineCount,
    };
  }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
