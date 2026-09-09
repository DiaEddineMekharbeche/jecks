import type { PrismaClient } from '@jecks/db';
import { describe, expect, it, vi } from 'vitest';
import {
  applyPriceSchedules,
  collectLowStockAlerts,
  detectAbandonedCarts,
} from './scheduling.js';

type Row = Record<string, unknown>;

const past = new Date(Date.now() - 3_600_000);

describe('applyPriceSchedules', () => {
  function harness(due: Row[], expired: Row[]) {
    const variantUpdate = vi.fn().mockResolvedValue({});
    const scheduleUpdate = vi.fn().mockResolvedValue({});
    const productUpdate = vi.fn().mockResolvedValue({});

    const prisma = {
      priceSchedule: {
        findMany: vi.fn().mockResolvedValueOnce(due).mockResolvedValueOnce(expired),
        update: scheduleUpdate,
      },
      variant: {
        update: variantUpdate,
        findUnique: vi.fn().mockResolvedValue({ productId: 'product-1' }),
        aggregate: vi.fn().mockResolvedValue({
          _min: { price: 300_000n },
          _max: { price: 400_000n, compareAtPrice: 500_000n },
        }),
      },
      product: { update: productUpdate },
      // The transaction helper just runs the operations it is handed.
      $transaction: vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    } as unknown as PrismaClient;

    return { prisma, variantUpdate, scheduleUpdate, productUpdate };
  }

  it('applies a schedule whose start has passed', async () => {
    const { prisma, variantUpdate, productUpdate } = harness(
      [
        {
          id: 'sched-1',
          variantId: 'variant-1',
          price: 290_000n,
          compareAtPrice: 400_000n,
          startsAt: past,
        },
      ],
      [],
    );

    const result = await applyPriceSchedules(prisma);

    expect(result).toEqual({ applied: 1, reverted: 0 });
    expect(variantUpdate).toHaveBeenCalledWith({
      where: { id: 'variant-1' },
      data: { price: 290_000n, compareAtPrice: 400_000n },
    });
    // The denormalized range the storefront sorts on has to follow.
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { minPrice: 300_000n, maxPrice: 400_000n, maxCompareAt: 500_000n },
    });
  });

  it('marks a closed window as reverted', async () => {
    const { prisma, scheduleUpdate } = harness([], [{ id: 'sched-2', variantId: 'variant-2' }]);

    const result = await applyPriceSchedules(prisma);

    expect(result).toEqual({ applied: 0, reverted: 1 });
    expect(scheduleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sched-2' } }),
    );
  });

  it('does nothing when there is nothing due', async () => {
    const { prisma, variantUpdate } = harness([], []);
    expect(await applyPriceSchedules(prisma)).toEqual({ applied: 0, reverted: 0 });
    expect(variantUpdate).not.toHaveBeenCalled();
  });

  it('skips the price-range refresh when the variant has vanished', async () => {
    const { prisma, productUpdate } = harness(
      [{ id: 's', variantId: 'gone', price: 1n, compareAtPrice: null, startsAt: past }],
      [],
    );
    (prisma.variant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await applyPriceSchedules(prisma);
    expect(productUpdate).not.toHaveBeenCalled();
  });
});

describe('detectAbandonedCarts', () => {
  function harness(carts: Row[]) {
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      cart: { findMany: vi.fn().mockResolvedValue(carts) },
      abandonedCart: { create },
    } as unknown as PrismaClient;
    return { prisma, create };
  }

  it('records a stale cart with its item count and subtotal', async () => {
    const { prisma, create } = harness([
      {
        id: 'cart-1',
        customerId: 'cust-1',
        wilayaCode: 16,
        customer: { id: 'cust-1', phone: '+213551234567', fullName: 'Yacine Benali' },
        items: [
          { quantity: 2, unitPrice: 350_000n },
          { quantity: 1, unitPrice: 290_000n },
        ],
      },
    ]);

    const result = await detectAbandonedCarts(prisma);

    expect(result).toEqual({ created: 1 });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cartId: 'cart-1',
        phone: '+213551234567',
        itemCount: 3,
        subtotal: 990_000n,
      }),
    });
  });

  it('returns zero when nothing qualifies', async () => {
    const { prisma, create } = harness([]);
    expect(await detectAbandonedCarts(prisma)).toEqual({ created: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('only looks at carts that are stale, unconverted and not already recorded', async () => {
    const { prisma } = harness([]);
    await detectAbandonedCarts(prisma);

    const where = (prisma.cart.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.where;
    expect(where.convertedOrderId).toBeNull();
    expect(where.abandoned).toBeNull();
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
  });
});

describe('collectLowStockAlerts', () => {
  function harness(products: Row[]) {
    return {
      findMany: vi.fn().mockResolvedValue(products),
    } as unknown as PrismaClient['product'];
  }

  const prismaWith = (products: Row[]): PrismaClient =>
    ({ product: harness(products) }) as unknown as PrismaClient;

  it('flags a variant at or below its product threshold', async () => {
    const alerts = await collectLowStockAlerts(
      prismaWith([
        {
          name: { fr: 'Trucker Atlas' },
          lowStockThreshold: 5,
          variants: [
            { sku: 'LOW-1', inventoryLevels: [{ onHand: 3, reserved: 0 }] },
            { sku: 'AT-THRESHOLD', inventoryLevels: [{ onHand: 5, reserved: 0 }] },
            { sku: 'FINE', inventoryLevels: [{ onHand: 30, reserved: 0 }] },
          ],
        },
      ]),
    );

    expect(alerts.map((alert) => alert.sku)).toEqual(['LOW-1', 'AT-THRESHOLD']);
    expect(alerts[0]).toEqual({
      sku: 'LOW-1',
      productName: 'Trucker Atlas',
      available: 3,
      threshold: 5,
    });
  });

  it('counts availability across locations and excludes reserved units', async () => {
    const alerts = await collectLowStockAlerts(
      prismaWith([
        {
          name: { fr: 'Bob Riviera' },
          lowStockThreshold: 4,
          variants: [
            {
              sku: 'SPLIT',
              inventoryLevels: [
                { onHand: 3, reserved: 2 },
                { onHand: 4, reserved: 3 },
              ],
            },
          ],
        },
      ]),
    );

    // (3 − 2) + (4 − 3) = 2, which is under the threshold of 4.
    expect(alerts[0]?.available).toBe(2);
  });

  it('never reports a negative quantity when reservations exceed stock', async () => {
    const alerts = await collectLowStockAlerts(
      prismaWith([
        {
          name: { fr: 'Snapback Casbah' },
          lowStockThreshold: 5,
          variants: [{ sku: 'OVERSOLD', inventoryLevels: [{ onHand: 1, reserved: 4 }] }],
        },
      ]),
    );
    expect(alerts[0]?.available).toBe(0);
  });

  it('falls back to an empty name when the product has no French title', async () => {
    const alerts = await collectLowStockAlerts(
      prismaWith([
        {
          name: null,
          lowStockThreshold: 5,
          variants: [{ sku: 'NO-NAME', inventoryLevels: [{ onHand: 0, reserved: 0 }] }],
        },
      ]),
    );
    expect(alerts[0]?.productName).toBe('');
  });

  it('returns nothing when every variant is well stocked', async () => {
    const alerts = await collectLowStockAlerts(
      prismaWith([
        {
          name: { fr: 'Fitted Alger 59' },
          lowStockThreshold: 5,
          variants: [{ sku: 'OK', inventoryLevels: [{ onHand: 40, reserved: 1 }] }],
        },
      ]),
    );
    expect(alerts).toEqual([]);
  });
});
