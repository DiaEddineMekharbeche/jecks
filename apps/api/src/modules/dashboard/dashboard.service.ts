import { Injectable, Logger } from '@nestjs/common';
import { rebuildDailyStats } from '@jecks/db';
import { PrismaService } from '../../prisma/prisma.service.js';

export type DashboardPeriod = '7d' | '30d' | '90d' | 'mtd' | 'ytd';

export interface KpiTile {
  key: string;
  value: bigint | number;
  previous: bigint | number;
  /** Percentage change against the comparison window; null when there is no base. */
  changePercent: number | null;
}

/**
 * Reads the pre-aggregated `daily_stats` table rather than scanning orders, so the
 * dashboard stays under the 1.5 s budget of PRD Section 1.3 as volume grows.
 *
 * That table is rebuilt by the worker at 00:20, which on its own left the dashboard a night
 * behind: an order placed this morning showed nowhere until tomorrow, and a new shop saw
 * empty tiles for its first day. So opening the dashboard first brings the table up to date
 * (see `ensureFresh`).
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private refreshing: Promise<void> | null = null;
  private lastRefresh = 0;

  constructor(private readonly prisma: PrismaService) {}

  async summary(period: DashboardPeriod) {
    const { from, to, previousFrom, previousTo } = resolveWindow(period);

    await this.ensureFresh(previousFrom, to);

    const [current, previous, attention] = await Promise.all([
      this.aggregate(from, to),
      this.aggregate(previousFrom, previousTo),
      this.needsAttention(),
    ]);

    const tiles: KpiTile[] = [
      tile('orders', current.ordersCount, previous.ordersCount),
      tile('revenue', current.revenue, previous.revenue),
      tile('grossProfit', current.grossProfit, previous.grossProfit),
      tile('netProfit', current.netProfit, previous.netProfit),
      tile('delivered', current.deliveredCount, previous.deliveredCount),
      tile('averageOrderValue', current.averageOrderValue, previous.averageOrderValue),
      tile('deliveryRate', current.deliveryRate, previous.deliveryRate),
      tile('adSpend', current.adSpend, previous.adSpend),
    ];

    const series = await this.prisma.dailyStat.findMany({
      where: { day: { gte: from, lte: to } },
      orderBy: { day: 'asc' },
      select: {
        day: true,
        ordersCount: true,
        deliveredCount: true,
        revenue: true,
        cogs: true,
        grossProfit: true,
        netProfit: true,
        adSpend: true,
      },
    });

    return { period, from, to, tiles, series, attention };
  }

  /**
   * Makes the day rows current before they are read.
   *
   * Two cases. A day in the window with no row at all (a shop's first days, or a window
   * wider than anything computed so far) is backfilled across the whole window, once: the
   * rebuild writes a row for every day, so the next visit finds none missing. Otherwise the
   * last three days are recomputed, at most every 30 seconds, which is what carries today's
   * orders and a late delivery into the figures. Concurrent visits share one rebuild.
   *
   * A failure is logged and the dashboard shows what is stored: a stale tile beats an error.
   */
  private async ensureFresh(oldest: Date, today: Date): Promise<void> {
    const wanted = Math.round((today.getTime() - oldest.getTime()) / 86_400_000) + 1;
    const have = await this.prisma.dailyStat.count({ where: { day: { gte: oldest, lte: today } } });
    const backfill = have < wanted;

    if (!backfill && Date.now() - this.lastRefresh < REFRESH_EVERY_MS) return;

    this.refreshing ??= rebuildDailyStats(this.prisma, {
      days: backfill ? Math.min(wanted, MAX_BACKFILL_DAYS) : 3,
    })
      .then(() => {
        this.lastRefresh = Date.now();
      })
      .catch((error: unknown) => {
        this.logger.warn(`daily_stats refresh failed: ${String(error)}`);
      })
      .finally(() => {
        this.refreshing = null;
      });

    await this.refreshing;
  }

  private async aggregate(from: Date, to: Date) {
    const totals = await this.prisma.dailyStat.aggregate({
      where: { day: { gte: from, lte: to } },
      _sum: {
        ordersCount: true,
        deliveredCount: true,
        failedCount: true,
        revenue: true,
        cogs: true,
        shippingCost: true,
        discounts: true,
        refunds: true,
        expenses: true,
        adSpend: true,
        grossProfit: true,
        netProfit: true,
      },
    });

    const sum = totals._sum;
    const ordersCount = sum.ordersCount ?? 0;
    const deliveredCount = sum.deliveredCount ?? 0;
    const failedCount = sum.failedCount ?? 0;
    const revenue = sum.revenue ?? 0n;

    return {
      ordersCount,
      deliveredCount,
      revenue,
      grossProfit: sum.grossProfit ?? 0n,
      netProfit: sum.netProfit ?? 0n,
      adSpend: sum.adSpend ?? 0n,
      averageOrderValue: deliveredCount > 0 ? revenue / BigInt(deliveredCount) : 0n,
      // Share of shipped parcels that actually arrived — PRD KPI table.
      deliveryRate:
        deliveredCount + failedCount > 0
          ? Math.round((deliveredCount / (deliveredCount + failedCount)) * 1000) / 10
          : 0,
    };
  }

  /** The "needs attention" widgets of PRD F-AD-03. */
  private async needsAttention() {
    const [
      pendingConfirmation,
      failedDeliveries,
      lowStock,
      pendingReviews,
      unreadMessages,
      abandonedCarts,
    ] = await Promise.all([
      this.prisma.order.count({ where: { status: 'PENDING' } }),
      this.prisma.order.count({ where: { status: 'FAILED' } }),
      this.prisma.product.count({ where: { status: 'ACTIVE', totalStock: { lte: 5 } } }),
      this.prisma.review.count({ where: { status: 'PENDING' } }),
      this.prisma.contactMessage.count({ where: { readAt: null } }),
      this.prisma.abandonedCart.count({ where: { contactedAt: null, recoveredOrderId: null } }),
    ]);

    return {
      pendingConfirmation,
      failedDeliveries,
      lowStock,
      pendingReviews,
      unreadMessages,
      abandonedCarts,
    };
  }
}

/** How long a rebuild of the last days is trusted before the next dashboard visit repeats it. */
const REFRESH_EVERY_MS = 30_000;

/** A year-to-date window of a young shop is small; this only stops a runaway scan. */
const MAX_BACKFILL_DAYS = 800;

function tile(key: string, value: bigint | number, previous: bigint | number): KpiTile {
  return { key, value, previous, changePercent: change(value, previous) };
}

function change(value: bigint | number, previous: bigint | number): number | null {
  const now = Number(value);
  const before = Number(previous);
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** Windows are whole UTC days, matching how `daily_stats` is keyed. */
export function resolveWindow(period: DashboardPeriod): {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
} {
  const to = startOfUtcDay(new Date());
  let from: Date;

  switch (period) {
    case '7d':
      from = addDays(to, -6);
      break;
    case '30d':
      from = addDays(to, -29);
      break;
    case '90d':
      from = addDays(to, -89);
      break;
    case 'mtd':
      from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
      break;
    case 'ytd':
      from = new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
      break;
  }

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return { from, to, previousFrom: addDays(from, -days), previousTo: addDays(from, -1) };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
