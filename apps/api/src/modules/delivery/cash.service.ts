import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@jecks/db';
import type { CashDaySummary, CashHolderSummary, CashReconcileInput } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { cashOutstanding } from './domain/settlement.js';

/**
 * The cash drawer — PRD F-AD-64.
 *
 * Cash on delivery means the shop's money spends a few days in other people's pockets.
 * This screen answers one question per holder: how much of ours are you holding, and
 * does it match what the orders say you collected.
 *
 * Three numbers, deliberately kept apart. *Expected* is what the delivered orders say
 * should have been collected. *Collected* is what the driver or courier reported.
 * *Reconciled* is what has actually been counted in at the office. A gap between the
 * first two is a conversation with the driver; a gap between the last two is just cash
 * that has not come back yet.
 */
@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  async daily(date: Date): Promise<CashDaySummary> {
    const from = startOfDay(date);
    const to = new Date(from.getTime() + 86_400_000);

    const collections = await this.prisma.codCollection.findMany({
      where: { collectedAt: { gte: from, lt: to } },
      include: {
        driver: { select: { id: true, user: { select: { name: true } } } },
        courier: { select: { id: true, name: true } },
        order: { select: { total: true, paidTotal: true, status: true } },
      },
    });

    const holders = new Map<string, CashHolderSummary & { expected: bigint; collected: bigint; reconciled: bigint }>();

    const keyOf = (collection: (typeof collections)[number]): string =>
      collection.driverId ? `driver:${collection.driverId}` : `courier:${collection.courierId ?? 'unknown'}`;

    for (const collection of collections) {
      const key = keyOf(collection);
      const existing =
        holders.get(key) ??
        {
          kind: collection.driverId ? ('driver' as const) : ('courier' as const),
          id: collection.driverId ?? collection.courierId ?? 'unknown',
          name:
            collection.driver?.user.name ??
            collection.courier?.name ??
            'Non attribué',
          expectedMinor: '0',
          collectedMinor: '0',
          outstandingMinor: '0',
          orderCount: 0,
          expected: 0n,
          collected: 0n,
          reconciled: 0n,
        };

      // What was owed before this collection was applied to the order. Delivery sets
      // `paidTotal`, so reading it now would say every order was already paid.
      existing.expected += bigMax(
        collection.order.total - collection.order.paidTotal + collection.amount,
        0n,
      );
      existing.collected += collection.amount;
      existing.reconciled += collection.reconciledAt ? collection.amount : 0n;
      existing.orderCount += 1;

      holders.set(key, existing);
    }

    // What the day's delivered orders said was due, whoever ended up carrying it.
    const delivered = await this.prisma.order.aggregate({
      where: { deliveredAt: { gte: from, lt: to }, status: OrderStatus.DELIVERED, paymentMethod: 'COD' },
      _sum: { total: true },
    });

    let collected = 0n;
    let reconciled = 0n;

    const summary: CashHolderSummary[] = [];
    for (const holder of holders.values()) {
      collected += holder.collected;
      reconciled += holder.reconciled;

      summary.push({
        kind: holder.kind,
        id: holder.id,
        name: holder.name,
        expectedMinor: holder.expected.toString(),
        collectedMinor: holder.collected.toString(),
        outstandingMinor: cashOutstanding({
          expectedMinor: holder.expected,
          collectedMinor: holder.collected,
          reconciledMinor: holder.reconciled,
        }).toString(),
        orderCount: holder.orderCount,
      });
    }

    const expected = delivered._sum.total ?? 0n;

    return {
      date: from.toISOString().slice(0, 10),
      expectedMinor: expected.toString(),
      collectedMinor: collected.toString(),
      reconciledMinor: reconciled.toString(),
      outstandingMinor: (collected - reconciled > 0n ? collected - reconciled : 0n).toString(),
      holders: summary.sort((a, b) => Number(BigInt(b.outstandingMinor) - BigInt(a.outstandingMinor))),
    };
  }

  /** Everything a holder is still carrying, whatever day they collected it. */
  async outstandingFor(kind: 'driver' | 'courier', id: string) {
    const collections = await this.prisma.codCollection.findMany({
      where: {
        reconciledAt: null,
        ...(kind === 'driver' ? { driverId: id } : { courierId: id }),
      },
      orderBy: { collectedAt: 'asc' },
      include: { order: { select: { number: true, customerName: true } } },
    });

    return collections.map((collection) => ({
      id: collection.id,
      orderNumber: collection.order.number,
      customerName: collection.order.customerName,
      amountMinor: collection.amount.toString(),
      collectedAt: collection.collectedAt.toISOString(),
      note: collection.note,
    }));
  }

  /**
   * Counts cash in.
   *
   * Reconciling twice is not an error worth refusing: the second call touches nothing
   * because the filter already excludes what is settled, and an operator clicking a
   * button again should not see a red message.
   */
  async reconcile(input: CashReconcileInput): Promise<{ reconciled: number; amountMinor: string }> {
    const pending = await this.prisma.codCollection.findMany({
      where: { id: { in: input.collectionIds }, reconciledAt: null },
      select: { id: true, amount: true },
    });

    if (pending.length === 0) return { reconciled: 0, amountMinor: '0' };

    const now = new Date();
    await this.prisma.codCollection.updateMany({
      where: { id: { in: pending.map((row) => row.id) } },
      data: { reconciledAt: now, ...(input.note ? { note: input.note } : {}) },
    });

    const total = pending.reduce((sum, row) => sum + row.amount, 0n);
    return { reconciled: pending.length, amountMinor: total.toString() };
  }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
