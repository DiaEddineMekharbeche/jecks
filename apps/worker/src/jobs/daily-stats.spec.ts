import type { PrismaClient } from '@jecks/db';
import { describe, expect, it, vi } from 'vitest';
import { rebuildDailyStats } from './daily-stats.js';

/**
 * The P&L arithmetic of PRD F-AD-70, tested without a database.
 *
 * The figures come from `computePnl` in @jecks/shared, the same function the report
 * uses, so these tests pin down what this job feeds it rather than a second definition:
 *
 * Revenue = delivered goods, net of discount, booked on the delivery date.
 * Gross   = revenue − COGS. Delivery is a margin of its own.
 * Net     = gross + delivery margin − fees − refunds − expenses − ad spend.
 */

type Row = Record<string, unknown>;

interface Fixture {
  orders?: Row[];
  expenses?: Array<{ incurredAt: Date; _sum: { amount: bigint } }>;
  adSpend?: Array<{ spentOn: Date; _sum: { amount: bigint } }>;
  customers?: Array<{ firstOrderAt: Date | null; _count: { _all: number } }>;
}

function fakePrisma(fixture: Fixture) {
  const written = new Map<string, Row>();

  const prisma = {
    order: { findMany: vi.fn().mockResolvedValue(fixture.orders ?? []) },
    expense: { groupBy: vi.fn().mockResolvedValue(fixture.expenses ?? []) },
    adSpend: { groupBy: vi.fn().mockResolvedValue(fixture.adSpend ?? []) },
    customer: { groupBy: vi.fn().mockResolvedValue(fixture.customers ?? []) },
    dailyStat: {
      upsert: vi.fn().mockImplementation((args: { where: { day: Date }; create: Row }) => {
        written.set(args.where.day.toISOString().slice(0, 10), args.create);
        return Promise.resolve(args.create);
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, written };
}

const day = (offset: number, hour = 12): Date => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

const key = (offset: number): string => day(offset).toISOString().slice(0, 10);

function order(overrides: Row = {}): Row {
  return {
    createdAt: day(1),
    deliveredAt: null,
    status: 'PENDING',
    total: 0n,
    itemsSubtotal: 0n,
    cogsTotal: 0n,
    shippingTotal: 0n,
    shippingCost: 0n,
    discountTotal: 0n,
    refundedTotal: 0n,
    payments: [],
    ...overrides,
  };
}

describe('rebuildDailyStats', () => {
  it('writes a row for every day in the window, even quiet ones', async () => {
    const { prisma, written } = fakePrisma({});
    const result = await rebuildDailyStats(prisma, { days: 3 });

    expect(result.days).toBe(3);
    expect(written.size).toBe(3);
    expect(written.get(key(0))?.ordersCount).toBe(0);
  });

  it('counts an order on the day it was placed', async () => {
    const { prisma, written } = fakePrisma({
      orders: [order({ createdAt: day(1), discountTotal: 5_000n })],
    });
    await rebuildDailyStats(prisma, { days: 3 });

    expect(written.get(key(1))?.ordersCount).toBe(1);
    expect(written.get(key(1))?.discounts).toBe(5_000n);
  });

  it('books revenue on the delivery date, not the order date', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({
          createdAt: day(2),
          deliveredAt: day(1),
          status: 'DELIVERED',
          total: 400_000n,
          itemsSubtotal: 400_000n,
          cogsTotal: 150_000n,
          shippingCost: 40_000n,
        }),
      ],
    });
    await rebuildDailyStats(prisma, { days: 4 });

    // The order counts on day 2; the money counts on day 1.
    expect(written.get(key(2))?.ordersCount).toBe(1);
    expect(written.get(key(2))?.revenue).toBe(0n);
    expect(written.get(key(1))?.revenue).toBe(400_000n);
    expect(written.get(key(1))?.deliveredCount).toBe(1);
  });

  it('computes gross profit on the goods alone', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({
          createdAt: day(1),
          deliveredAt: day(1),
          status: 'DELIVERED',
          total: 540_000n,
          itemsSubtotal: 500_000n,
          cogsTotal: 180_000n,
          shippingTotal: 40_000n,
          shippingCost: 40_000n,
        }),
      ],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    // 500 000 − 180 000. Delivery is not part of it.
    expect(written.get(key(1))?.grossProfit).toBe(320_000n);
    expect(written.get(key(1))?.shippingRevenue).toBe(40_000n);
  });

  it('books revenue net of the discount', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({
          createdAt: day(1),
          deliveredAt: day(1),
          status: 'DELIVERED',
          total: 450_000n,
          itemsSubtotal: 500_000n,
          discountTotal: 50_000n,
          cogsTotal: 180_000n,
        }),
      ],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    expect(written.get(key(1))?.revenue).toBe(450_000n);
  });

  it('records the payment fees an order carried', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({
          createdAt: day(1),
          deliveredAt: day(1),
          status: 'DELIVERED',
          total: 500_000n,
          itemsSubtotal: 500_000n,
          payments: [{ feeAmount: 7_500n }],
        }),
      ],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    expect(written.get(key(1))?.paymentFees).toBe(7_500n);
    // Fees come off the net, never off the gross.
    expect(written.get(key(1))?.grossProfit).toBe(500_000n);
    expect(written.get(key(1))?.netProfit).toBe(492_500n);
  });

  it('takes fees, expenses and ad spend off to reach net profit', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({
          createdAt: day(1),
          deliveredAt: day(1),
          status: 'DELIVERED',
          total: 540_000n,
          itemsSubtotal: 500_000n,
          cogsTotal: 180_000n,
          shippingTotal: 40_000n,
          shippingCost: 40_000n,
        }),
      ],
      expenses: [{ incurredAt: day(1, 0), _sum: { amount: 60_000n } }],
      adSpend: [{ spentOn: day(1, 0), _sum: { amount: 30_000n } }],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    const row = written.get(key(1));
    expect(row?.expenses).toBe(60_000n);
    expect(row?.adSpend).toBe(30_000n);
    // 320 000 gross, delivery breaks even, − 60 000 − 30 000.
    expect(row?.netProfit).toBe(230_000n);
  });

  it('reports a loss when costs exceed revenue', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({
          createdAt: day(1),
          deliveredAt: day(1),
          status: 'DELIVERED',
          total: 100_000n,
          itemsSubtotal: 100_000n,
          cogsTotal: 130_000n,
          shippingCost: 40_000n,
        }),
      ],
      adSpend: [{ spentOn: day(1, 0), _sum: { amount: 50_000n } }],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    // Sold below cost, delivery unpaid, and advertising on top.
    expect(written.get(key(1))?.grossProfit).toBe(-30_000n);
    expect(written.get(key(1))?.netProfit).toBe(-120_000n);
  });

  it('subtracts a refund from the day the order was delivered', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({
          createdAt: day(1),
          deliveredAt: day(1),
          status: 'REFUNDED',
          total: 300_000n,
          refundedTotal: 300_000n,
          shippingCost: 40_000n,
        }),
      ],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    const row = written.get(key(1));
    // A refunded order is not revenue, and its delivery and refund are still costs.
    expect(row?.revenue).toBe(0n);
    expect(row?.deliveredCount).toBe(0);
    expect(row?.refunds).toBe(300_000n);
    expect(row?.grossProfit).toBe(0n);
    expect(row?.netProfit).toBe(-340_000n);
  });

  it('counts failed and cancelled orders without booking revenue', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({ createdAt: day(1), status: 'FAILED', total: 200_000n }),
        order({ createdAt: day(1), status: 'CANCELLED', total: 150_000n }),
      ],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    const row = written.get(key(1));
    expect(row?.failedCount).toBe(1);
    expect(row?.cancelledCount).toBe(1);
    expect(row?.revenue).toBe(0n);
  });

  it('sums several deliveries on the same day', async () => {
    const { prisma, written } = fakePrisma({
      orders: [
        order({ createdAt: day(1), deliveredAt: day(1), status: 'DELIVERED', total: 100_000n, itemsSubtotal: 100_000n, cogsTotal: 40_000n }),
        order({ createdAt: day(1), deliveredAt: day(1), status: 'DELIVERED', total: 250_000n, itemsSubtotal: 250_000n, cogsTotal: 90_000n }),
      ],
    });
    await rebuildDailyStats(prisma, { days: 2 });

    const row = written.get(key(1));
    expect(row?.revenue).toBe(350_000n);
    expect(row?.cogs).toBe(130_000n);
    expect(row?.deliveredCount).toBe(2);
  });

  it('records new customers on the day of their first order', async () => {
    const { prisma, written } = fakePrisma({
      customers: [{ firstOrderAt: day(1), _count: { _all: 4 } }],
    });
    await rebuildDailyStats(prisma, { days: 2 });
    expect(written.get(key(1))?.newCustomers).toBe(4);
  });

  it('ignores a customer with no first order', async () => {
    const { prisma, written } = fakePrisma({
      customers: [{ firstOrderAt: null, _count: { _all: 9 } }],
    });
    await rebuildDailyStats(prisma, { days: 2 });
    expect(written.get(key(1))?.newCustomers).toBe(0);
  });

  it('defaults to a three-day window, so a late delivery is picked up', async () => {
    const { prisma, written } = fakePrisma({});
    const result = await rebuildDailyStats(prisma);
    expect(result.days).toBe(3);
    expect(written.size).toBe(3);
  });
});
