import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * Keeps the denormalized columns on `products` honest — DECISIONS D25.
 *
 * `minPrice`, `maxPrice`, `maxCompareAt`, `totalStock`, `ratingAverage` and
 * `ratingCount` are cached on the product so a collection grid never joins variants and
 * inventory levels. The price of that is an owner: every write that touches a variant,
 * an inventory level or a review moderation calls back here in the same request.
 *
 * The recompute is deliberately a full re-aggregation rather than an increment. An
 * increment drifts the first time two writes race; re-reading is one indexed query and
 * cannot drift.
 */
@Injectable()
export class RollupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recomputes prices and stock for one product. */
  async refreshProduct(productId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;

    const [range, levels] = await Promise.all([
      db.variant.aggregate({
        where: { productId, active: true, deletedAt: null },
        _min: { price: true },
        _max: { price: true, compareAtPrice: true },
      }),
      db.inventoryLevel.findMany({
        where: { variant: { productId, active: true, deletedAt: null } },
        select: { onHand: true, reserved: true },
      }),
    ]);

    await db.product.update({
      where: { id: productId },
      data: {
        minPrice: range._min.price ?? 0n,
        maxPrice: range._max.price ?? 0n,
        // A product with no compare-at price must clear the column, not keep a stale
        // one, or the storefront keeps showing a "sale" badge on a full-price product.
        maxCompareAt: range._max.compareAtPrice ?? null,
        totalStock: availableStock(levels),
      },
    });
  }

  async refreshProducts(productIds: string[], tx?: Prisma.TransactionClient): Promise<void> {
    for (const id of unique(productIds)) await this.refreshProduct(id, tx);
  }

  /**
   * Recomputes the rating rollup from approved reviews only — a pending or rejected
   * review must not move the star rating a shopper sees.
   */
  async refreshRating(productId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;

    const stats = await db.review.aggregate({
      where: { productId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await db.product.update({
      where: { id: productId },
      data: {
        // Decimal(3,2): two decimals is what the storefront renders.
        ratingAverage: round2(stats._avg.rating ?? 0),
        ratingCount: stats._count._all,
      },
    });
  }

  async refreshRatings(productIds: string[], tx?: Prisma.TransactionClient): Promise<void> {
    for (const id of unique(productIds)) await this.refreshRating(id, tx);
  }
}

/**
 * Oversold stock is clamped per location, not in the total. A location holding one unit
 * against four reservations contributes nothing; letting it contribute -3 would hide
 * real stock sitting in another warehouse.
 */
export function availableStock(levels: Array<{ onHand: number; reserved: number }>): number {
  return levels.reduce((sum, level) => sum + Math.max(level.onHand - level.reserved, 0), 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
