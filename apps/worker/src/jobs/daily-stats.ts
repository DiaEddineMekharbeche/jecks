import type { PrismaClient } from '@jecks/db';
import { computePnl } from '@jecks/shared';

/**
 * Rebuilds `daily_stats` for a window of days — PRD Section 10.7 and F-AD-70.
 *
 * Revenue is booked on the delivery date, not the order date: a COD order is not
 * revenue until the customer has the parcel and the driver has the cash. Costs follow
 * the same day so a day's margin is internally consistent.
 *
 * Default window is 3 days rather than 1, because a delivery can be marked late and a
 * refund can land after the fact; recomputing recent days is cheap and self-healing.
 */
export interface DailyStatsOptions {
  days?: number;
}

export async function rebuildDailyStats(
  prisma: PrismaClient,
  options: DailyStatsOptions = {},
): Promise<{ days: number }> {
  const windowDays = options.days ?? 3;
  const today = startOfUtcDay(new Date());
  const from = new Date(today.getTime() - (windowDays - 1) * 86_400_000);

  const [orders, expenses, adSpend, newCustomers] = await Promise.all([
    prisma.order.findMany({
      where: {
        OR: [{ createdAt: { gte: from } }, { deliveredAt: { gte: from } }],
      },
      select: {
        createdAt: true,
        deliveredAt: true,
        status: true,
        total: true,
        itemsSubtotal: true,
        cogsTotal: true,
        shippingTotal: true,
        shippingCost: true,
        discountTotal: true,
        refundedTotal: true,
        payments: { select: { feeAmount: true } },
      },
    }),
    prisma.expense.groupBy({
      by: ['incurredAt'],
      where: { incurredAt: { gte: from }, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.adSpend.groupBy({
      by: ['spentOn'],
      where: { spentOn: { gte: from } },
      _sum: { amount: true },
    }),
    prisma.customer.groupBy({
      by: ['firstOrderAt'],
      where: { firstOrderAt: { gte: from } },
      _count: { _all: true },
    }),
  ]);

  const expenseByDay = new Map(expenses.map((row) => [key(row.incurredAt), row._sum.amount ?? 0n]));
  const adByDay = new Map(adSpend.map((row) => [key(row.spentOn), row._sum.amount ?? 0n]));

  const newByDay = new Map<string, number>();
  for (const row of newCustomers) {
    if (!row.firstOrderAt) continue;
    const day = key(row.firstOrderAt);
    newByDay.set(day, (newByDay.get(day) ?? 0) + row._count._all);
  }

  interface Bucket {
    ordersCount: number;
    deliveredCount: number;
    failedCount: number;
    cancelledCount: number;
    revenue: bigint;
    cogs: bigint;
    shippingRevenue: bigint;
    shippingCost: bigint;
    discounts: bigint;
    paymentFees: bigint;
    refunds: bigint;
  }

  const blank = (): Bucket => ({
    ordersCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    revenue: 0n,
    cogs: 0n,
    shippingRevenue: 0n,
    shippingCost: 0n,
    discounts: 0n,
    paymentFees: 0n,
    refunds: 0n,
  });

  const buckets = new Map<string, Bucket>();
  const bucketFor = (day: string): Bucket => {
    const existing = buckets.get(day);
    if (existing) return existing;
    const fresh = blank();
    buckets.set(day, fresh);
    return fresh;
  };

  for (const order of orders) {
    if (order.createdAt >= from) {
      const placed = bucketFor(key(order.createdAt));
      placed.ordersCount += 1;
      placed.discounts += order.discountTotal;
      if (order.status === 'FAILED') placed.failedCount += 1;
      if (order.status === 'CANCELLED') placed.cancelledCount += 1;
    }

    if (order.deliveredAt && order.deliveredAt >= from) {
      const delivered = bucketFor(key(order.deliveredAt));
      if (order.status === 'DELIVERED') {
        delivered.deliveredCount += 1;
        // Goods only, already net of the discount: the P&L treats delivery as its own
        // line rather than as revenue.
        delivered.revenue += order.itemsSubtotal - order.discountTotal;
        delivered.cogs += order.cogsTotal;
        delivered.shippingRevenue += order.shippingTotal;
      }
      delivered.shippingCost += order.shippingCost;
      delivered.paymentFees += order.payments.reduce((sum, payment) => sum + payment.feeAmount, 0n);
      delivered.refunds += order.refundedTotal;
    }
  }

  // Days with no orders still need a row, or a chart shows a gap instead of a zero.
  for (let offset = 0; offset < windowDays; offset += 1) {
    bucketFor(key(new Date(from.getTime() + offset * 86_400_000)));
  }

  for (const [day, bucket] of buckets) {
    const dayExpenses = expenseByDay.get(day) ?? 0n;
    const dayAds = adByDay.get(day) ?? 0n;
    // The same function the P&L report uses. Two implementations of "profit" is one
    // more than a shop can afford.
    const pnl = computePnl({
      revenueMinor: bucket.revenue,
      cogsMinor: bucket.cogs,
      shippingRevenueMinor: bucket.shippingRevenue,
      shippingCostMinor: bucket.shippingCost,
      discountsMinor: bucket.discounts,
      paymentFeesMinor: bucket.paymentFees,
      refundsMinor: bucket.refunds,
      expensesMinor: dayExpenses,
      adSpendMinor: dayAds,
    });

    const row = {
      ordersCount: bucket.ordersCount,
      deliveredCount: bucket.deliveredCount,
      failedCount: bucket.failedCount,
      cancelledCount: bucket.cancelledCount,
      revenue: bucket.revenue,
      cogs: bucket.cogs,
      shippingRevenue: bucket.shippingRevenue,
      shippingCost: bucket.shippingCost,
      discounts: bucket.discounts,
      paymentFees: bucket.paymentFees,
      refunds: bucket.refunds,
      expenses: dayExpenses,
      adSpend: dayAds,
      grossProfit: pnl.grossProfitMinor,
      netProfit: pnl.netProfitMinor,
      newCustomers: newByDay.get(day) ?? 0,
      computedAt: new Date(),
    };

    await prisma.dailyStat.upsert({
      where: { day: new Date(`${day}T00:00:00.000Z`) },
      create: { day: new Date(`${day}T00:00:00.000Z`), ...row },
      update: row,
    });
  }

  return { days: buckets.size };
}

function key(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
