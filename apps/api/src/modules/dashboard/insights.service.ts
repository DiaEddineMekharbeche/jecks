import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@jecks/db';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The second half of the dashboard — PRD F-AD-02 and F-AD-04.
 *
 * Where orders come from, when they arrive, how many of them survive to a doorstep, and
 * what somebody changed this morning. These answers need the orders themselves rather
 * than `daily_stats`, so they live apart from the KPI tiles and are fetched separately:
 * a heatmap is worth a second request, and it should not delay the numbers at the top.
 */

export interface WilayaCell {
  wilayaCode: number;
  wilayaName: string;
  orders: number;
  delivered: number;
  revenueMinor: string;
  /** Delivered against finished, as a percentage. */
  successRate: number;
}

export interface HeatCell {
  /** 0 is Monday, matching how a week is read here. */
  weekday: number;
  hour: number;
  orders: number;
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  ofPrevious: number;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entity: string;
  entityLabel: string | null;
  actorName: string;
  createdAt: string;
}

export interface EndingPromotion {
  id: string;
  name: string;
  code: string | null;
  endsAt: string;
  usageCount: number;
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async insights(from: Date, to: Date) {
    const end = new Date(to.getTime() + 86_400_000);

    const [byWilaya, heatmap, funnel, activity, endingPromotions] = await Promise.all([
      this.byWilaya(from, end),
      this.heatmap(from, end),
      this.funnel(from, end),
      this.activity(),
      this.endingPromotions(),
    ]);

    return { byWilaya, heatmap, funnel, activity, endingPromotions };
  }

  /**
   * Orders and revenue per wilaya.
   *
   * The success rate is what makes this worth drawing: a wilaya that orders often and
   * receives rarely is costing money on every parcel, and the volume alone hides that.
   */
  private async byWilaya(from: Date, end: Date): Promise<WilayaCell[]> {
    const orders = await this.prisma.order.findMany({
      where: { deletedAt: null, createdAt: { gte: from, lt: end } },
      select: { wilayaCode: true, wilayaName: true, status: true, total: true },
    });

    const cells = new Map<number, { name: string; orders: number; delivered: number; failed: number; revenue: bigint }>();

    for (const order of orders) {
      const cell = cells.get(order.wilayaCode) ?? {
        name: order.wilayaName,
        orders: 0,
        delivered: 0,
        failed: 0,
        revenue: 0n,
      };

      cell.orders += 1;
      if (order.status === OrderStatus.DELIVERED) {
        cell.delivered += 1;
        cell.revenue += order.total;
      }
      if (order.status === OrderStatus.FAILED || order.status === OrderStatus.RETURNED) {
        cell.failed += 1;
      }

      cells.set(order.wilayaCode, cell);
    }

    return [...cells.entries()]
      .map(([wilayaCode, cell]) => {
        const finished = cell.delivered + cell.failed;
        return {
          wilayaCode,
          wilayaName: cell.name,
          orders: cell.orders,
          delivered: cell.delivered,
          revenueMinor: cell.revenue.toString(),
          successRate: finished === 0 ? 0 : Math.round((cell.delivered / finished) * 1000) / 10,
        };
      })
      .sort((a, b) => b.orders - a.orders);
  }

  /**
   * When orders arrive, by weekday and hour, in Algiers time.
   *
   * Read in UTC it would be an hour out all year, which is enough to move the evening
   * peak into the wrong bucket and send a campaign at the wrong time.
   */
  private async heatmap(from: Date, end: Date): Promise<HeatCell[]> {
    const orders = await this.prisma.order.findMany({
      where: { deletedAt: null, createdAt: { gte: from, lt: end } },
      select: { createdAt: true },
    });

    const grid = new Map<string, number>();

    for (const order of orders) {
      // Algeria is UTC+1 all year: no daylight saving since 1981.
      const local = new Date(order.createdAt.getTime() + 3_600_000);
      const weekday = (local.getUTCDay() + 6) % 7;
      const hour = local.getUTCHours();
      const key = `${weekday}-${hour}`;
      grid.set(key, (grid.get(key) ?? 0) + 1);
    }

    const cells: HeatCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        cells.push({ weekday, hour, orders: grid.get(`${weekday}-${hour}`) ?? 0 });
      }
    }

    return cells;
  }

  /**
   * Views to delivered parcels.
   *
   * It ends at delivery rather than at checkout on purpose: a funnel that stops when the
   * order is placed tells a cash-on-delivery shop it converts far better than it does.
   */
  private async funnel(from: Date, end: Date): Promise<FunnelStep[]> {
    const [views, carts, checkouts, placed, delivered] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: { name: 'product_view', occurredAt: { gte: from, lt: end } },
      }),
      this.prisma.analyticsEvent.count({
        where: { name: 'add_to_cart', occurredAt: { gte: from, lt: end } },
      }),
      this.prisma.analyticsEvent.count({
        where: { name: 'checkout_start', occurredAt: { gte: from, lt: end } },
      }),
      this.prisma.order.count({ where: { deletedAt: null, createdAt: { gte: from, lt: end } } }),
      this.prisma.order.count({
        where: { deletedAt: null, status: OrderStatus.DELIVERED, deliveredAt: { gte: from, lt: end } },
      }),
    ]);

    const steps = [
      { key: 'views', label: 'Vues produit', count: views },
      { key: 'carts', label: 'Ajouts au panier', count: carts },
      { key: 'checkouts', label: 'Checkout entamé', count: checkouts },
      { key: 'orders', label: 'Commandes', count: placed },
      { key: 'delivered', label: 'Livrées', count: delivered },
    ];

    return steps.map((step, index) => {
      const previous = index === 0 ? step.count : steps[index - 1]!.count;
      return {
        ...step,
        ofPrevious: previous === 0 ? 0 : Math.round((step.count / previous) * 1000) / 10,
      };
    });
  }

  /** What the team has been doing, straight from the audit log. */
  private async activity(): Promise<ActivityEntry[]> {
    const entries = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorLabel: true,
        createdAt: true,
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entity: entry.entityType,
      entityLabel: entry.entityId ? entry.entityId.slice(0, 8) : null,
      actorName: entry.actorLabel ?? 'Système',
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  /**
   * Promotions about to end.
   *
   * A flash sale that expires unnoticed at two in the morning is a campaign nobody got
   * to extend, so the dashboard says so a week ahead.
   */
  private async endingPromotions(): Promise<EndingPromotion[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 86_400_000);

    const promotions = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        active: true,
        endsAt: { gte: now, lte: horizon },
      },
      orderBy: { endsAt: 'asc' },
      take: 10,
      select: { id: true, name: true, code: true, endsAt: true, usageCount: true },
    });

    return promotions.map((promotion) => ({
      id: promotion.id,
      name: promotion.name,
      code: promotion.code,
      endsAt: promotion.endsAt!.toISOString(),
      usageCount: promotion.usageCount,
    }));
  }
}
