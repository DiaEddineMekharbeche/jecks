import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import { PromotionScope, PromotionType } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { applyPromotions } from './engine/promo-engine.js';
import type { CartLine, PromoContext, PromoResult, PromoRule } from './engine/types.js';

/**
 * The database side of the promo engine — PRD F-AD-20/21.
 *
 * This service does exactly two things: turn rows into `PromoRule`s, and record what
 * was granted once an order exists. All of the deciding happens in the engine, which
 * knows nothing about Prisma. That separation is what keeps the discount rules
 * testable without a database and the queries here boringly simple.
 */

const INCLUDE = {
  products: { select: { productId: true } },
  variants: { select: { variantId: true } },
  collections: { select: { collectionId: true } },
  categories: { select: { categoryId: true } },
  customerGroups: { select: { groupId: true } },
} satisfies Prisma.PromotionInclude;

type PromotionRecord = Prisma.PromotionGetPayload<{ include: typeof INCLUDE }>;

export interface EvaluateInput {
  lines: CartLine[];
  customerId: string | null;
  wilayaCode: number | null;
  codes: string[];
  shippingMinor: bigint;
  now?: Date;
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates a cart: loads the automatic promotions plus whatever the typed codes
   * resolve to, then hands the whole set to the engine.
   */
  async evaluate(input: EvaluateInput): Promise<PromoResult> {
    const now = input.now ?? new Date();
    const codes = [...new Set(input.codes.map((code) => code.trim().toUpperCase()))].filter(Boolean);

    const [automatic, byCode, customer] = await Promise.all([
      this.loadAutomatic(now),
      this.loadByCodes(codes),
      this.loadCustomer(input.customerId),
    ]);

    // A promotion reachable both automatically and by code must only be considered
    // once, and the coded form wins because it carries the unique-code limits.
    const merged = new Map<string, PromoRule>();
    for (const rule of automatic) merged.set(rule.id, rule);
    for (const rule of byCode) merged.set(rule.id, rule);

    const context: PromoContext = {
      lines: input.lines,
      customer,
      wilayaCode: input.wilayaCode,
      codes,
      shippingMinor: input.shippingMinor,
      now,
    };

    return applyPromotions(context, [...merged.values()]);
  }

  /**
   * Writes the usage rows once an order exists.
   *
   * Counters are incremented here rather than at evaluation time, because a shopper
   * who types a code and then abandons the cart has not used it. Called inside the
   * order-creation transaction so a failed order leaves no usage behind.
   */
  async recordUsage(
    tx: Prisma.TransactionClient,
    result: PromoResult,
    order: { id: string; customerId: string | null },
  ): Promise<void> {
    for (const promotion of result.applied) {
      await tx.promoUsage.create({
        data: {
          promotionId: promotion.promotionId,
          promoCodeId: promotion.promoCodeId,
          orderId: order.id,
          customerId: order.customerId,
          amount: promotion.amountMinor,
        },
      });

      await tx.promotion.update({
        where: { id: promotion.promotionId },
        data: { usageCount: { increment: 1 } },
      });

      if (promotion.promoCodeId) {
        await tx.promoCode.update({
          where: { id: promotion.promoCodeId },
          data: { usageCount: { increment: 1 } },
        });
      }
    }
  }

  /** Gives the counters back when an order is cancelled before it ever shipped. */
  async releaseUsage(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const usages = await tx.promoUsage.findMany({
      where: { orderId },
      select: { id: true, promotionId: true, promoCodeId: true },
    });

    for (const usage of usages) {
      await tx.promotion.update({
        where: { id: usage.promotionId },
        // Guarded so a double release cannot drive the counter negative and hand out
        // more uses than the promotion ever had.
        data: { usageCount: { decrement: 1 } },
      });
      if (usage.promoCodeId) {
        await tx.promoCode.update({
          where: { id: usage.promoCodeId },
          data: { usageCount: { decrement: 1 } },
        });
      }
    }

    await tx.promoUsage.deleteMany({ where: { orderId } });
    await tx.promotion.updateMany({ where: { usageCount: { lt: 0 } }, data: { usageCount: 0 } });
    await tx.promoCode.updateMany({ where: { usageCount: { lt: 0 } }, data: { usageCount: 0 } });
  }

  /** Automatic promotions currently in their window, for the storefront badges. */
  async activeAutomatic(now = new Date()): Promise<PromoRule[]> {
    return this.loadAutomatic(now);
  }

  // --- loading --------------------------------------------------------------

  private async loadAutomatic(now: Date): Promise<PromoRule[]> {
    const rows = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        active: true,
        code: null,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      include: INCLUDE,
      orderBy: { priority: 'desc' },
      take: 50,
    });
    return rows.map((row) => toRule(row));
  }

  /**
   * Resolves typed codes. A code is either the promotion's own code or one of the bulk
   * unique codes, so both tables are searched and the unique code's remaining uses
   * travel with the rule.
   */
  private async loadByCodes(codes: string[]): Promise<PromoRule[]> {
    if (codes.length === 0) return [];

    const [direct, unique] = await Promise.all([
      this.prisma.promotion.findMany({
        where: { deletedAt: null, code: { in: codes } },
        include: INCLUDE,
      }),
      this.prisma.promoCode.findMany({
        where: { code: { in: codes } },
        include: { promotion: { include: INCLUDE } },
      }),
    ]);

    const rules = direct.map((row) => toRule(row));

    for (const entry of unique) {
      if (entry.promotion.deletedAt) continue;
      rules.push(
        toRule(entry.promotion, {
          code: entry.code,
          promoCodeId: entry.id,
          codeUsesRemaining: entry.usageLimit - entry.usageCount,
          // A unique code can carry its own expiry, tighter than the promotion's.
          endsAt: entry.expiresAt ?? entry.promotion.endsAt,
        }),
      );
    }

    return rules;
  }

  private async loadCustomer(customerId: string | null): Promise<PromoContext['customer']> {
    if (!customerId) {
      return { id: null, groupId: null, orderCount: 0, usageByPromotion: {} };
    }

    const [customer, usages] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { groupId: true, ordersCount: true },
      }),
      this.prisma.promoUsage.groupBy({
        by: ['promotionId'],
        where: { customerId },
        _count: { _all: true },
      }),
    ]);

    return {
      id: customerId,
      groupId: customer?.groupId ?? null,
      orderCount: customer?.ordersCount ?? 0,
      usageByPromotion: Object.fromEntries(
        usages.map((usage) => [usage.promotionId, usage._count._all]),
      ),
    };
  }
}

/** Flattens a row and its join tables into the shape the engine reads. */
export function toRule(
  row: PromotionRecord,
  overrides: Partial<PromoRule> = {},
): PromoRule {
  const buyXGetY = row.buyXGetY as PromoRule['buyXGetY'] | null;
  const tiers = (row.tiers ?? []) as Array<{ minSubtotal: string | number; percentOff: number }>;

  return {
    id: row.id,
    name: row.name,
    type: row.type as PromotionType,
    scope: row.scope as PromotionScope,
    code: row.code,
    promoCodeId: null,

    percentOff: row.percentOff === null ? null : Number(row.percentOff),
    amountOffMinor: row.amountOff,
    bundlePriceMinor: row.bundlePrice,
    buyXGetY,
    tiers: (Array.isArray(tiers) ? tiers : []).map((tier) => ({
      minSubtotalMinor: BigInt(tier.minSubtotal ?? 0),
      percentOff: Number(tier.percentOff ?? 0),
    })),

    minSubtotalMinor: row.minSubtotal,
    minQuantity: row.minQuantity,
    firstOrderOnly: row.firstOrderOnly,
    wilayaCodes: row.wilayaCodes,

    productIds: row.products.map((link) => link.productId),
    variantIds: row.variants.map((link) => link.variantId),
    collectionIds: row.collections.map((link) => link.collectionId),
    categoryIds: row.categories.map((link) => link.categoryId),
    customerGroupIds: row.customerGroups.map((link) => link.groupId),

    usageLimitTotal: row.usageLimitTotal,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    usageCount: row.usageCount,

    stackable: row.stackable,
    priority: row.priority,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: row.active,
    ...overrides,
  };
}
