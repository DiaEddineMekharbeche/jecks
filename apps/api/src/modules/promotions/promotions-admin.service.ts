import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@jecks/db';
import {
  PromotionType,
  type AdminListQuery,
  type AdminListResponse,
  type BulkCodeInput,
  type PromotionInput,
} from '@jecks/shared';
import type { ExportColumn } from '../../common/list/export.service.js';
import { andWhere, listResponse, planExport, planList } from '../../common/list/list.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CartLine } from './engine/types.js';
import { PromotionsService, toRule } from './promotions.service.js';

/**
 * Promotion administration — PRD F-AD-20/21.
 *
 * The engine decides discounts; this owns the rows behind them, plus two things an
 * owner needs before trusting a promotion: a simulator that runs the real engine
 * against a real cart, and a performance figure that comes from actual usage rather
 * than from what the promotion hoped to achieve.
 */

const SORTABLE: Record<string, string> = {
  createdAt: 'createdAt',
  name: 'name',
  priority: 'priority',
  usageCount: 'usageCount',
  startsAt: 'startsAt',
  endsAt: 'endsAt',
};

const INCLUDE = {
  products: { select: { productId: true } },
  variants: { select: { variantId: true } },
  collections: { select: { collectionId: true } },
  categories: { select: { categoryId: true } },
  customerGroups: { select: { groupId: true } },
  _count: { select: { codes: true, usages: true } },
} satisfies Prisma.PromotionInclude;

type PromotionRecord = Prisma.PromotionGetPayload<{ include: typeof INCLUDE }>;

export interface PromotionRow {
  id: string;
  name: string;
  code: string | null;
  type: PromotionType;
  scope: string;
  /** `scheduled`, `active` or `expired`, computed from the window and the flag. */
  state: 'draft' | 'scheduled' | 'active' | 'expired' | 'exhausted';
  percentOff: number | null;
  amountOffMinor: string | null;
  usageCount: number;
  usageLimitTotal: number | null;
  codeCount: number;
  /** Money this promotion has actually given away, minor units. */
  grantedMinor: string;
  stackable: boolean;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface PromotionDetail extends PromotionRow {
  description: string | null;
  bundlePriceMinor: string | null;
  buyXGetY: { buyQuantity: number; getQuantity: number; getDiscountPercent: number } | null;
  tiers: Array<{ minSubtotalMinor: string; percentOff: number }>;
  minSubtotalMinor: string | null;
  minQuantity: number | null;
  firstOrderOnly: boolean;
  wilayaCodes: number[];
  productIds: string[];
  variantIds: string[];
  collectionIds: string[];
  categoryIds: string[];
  customerGroupIds: string[];
  usageLimitPerCustomer: number | null;
  showCountdown: boolean;
}

@Injectable()
export class PromotionsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
  ) {}

  // --- reads ----------------------------------------------------------------

  async list(
    query: AdminListQuery,
    filters: { state?: string[]; type?: string[] },
  ): Promise<AdminListResponse<PromotionRow>> {
    const where = this.buildWhere(query, filters);
    const plan = planList(query, SORTABLE, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        include: INCLUDE,
        orderBy: plan.orderBy as Prisma.PromotionOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
      }),
      this.prisma.promotion.count({ where }),
    ]);

    const granted = await this.grantedByPromotion(rows.map((row) => row.id));
    const mapped = rows.map((row) => toRow(row, granted.get(row.id) ?? 0n));

    const states = filters.state ?? [];
    const filtered = states.length > 0 ? mapped.filter((row) => states.includes(row.state)) : mapped;

    return listResponse(query, filtered, states.length > 0 ? filtered.length : total);
  }

  async listForExport(
    query: AdminListQuery,
    filters: { state?: string[]; type?: string[] },
  ): Promise<PromotionRow[]> {
    const where = this.buildWhere(query, filters);
    const { take } = planExport(await this.prisma.promotion.count({ where }));

    const rows = await this.prisma.promotion.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take,
    });
    const granted = await this.grantedByPromotion(rows.map((row) => row.id));
    return rows.map((row) => toRow(row, granted.get(row.id) ?? 0n));
  }

  async get(id: string): Promise<PromotionDetail> {
    const row = await this.prisma.promotion.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Promotion not found' });

    const granted = await this.grantedByPromotion([row.id]);
    return toDetail(row, granted.get(row.id) ?? 0n);
  }

  /** Counters for the list tabs. */
  async counts(): Promise<Record<string, number>> {
    const rows = await this.prisma.promotion.findMany({
      where: { deletedAt: null },
      include: INCLUDE,
    });
    const out: Record<string, number> = {
      ALL: rows.length,
      active: 0,
      scheduled: 0,
      expired: 0,
      draft: 0,
      exhausted: 0,
    };
    for (const row of rows) out[stateOf(row)] = (out[stateOf(row)] ?? 0) + 1;
    return out;
  }

  // --- writes ---------------------------------------------------------------

  async create(input: PromotionInput): Promise<PromotionDetail> {
    await this.assertCodeFree(input.code ?? null);

    const created = await this.prisma.$transaction(async (tx) => {
      const promotion = await tx.promotion.create({
        data: this.toData(input),
        select: { id: true },
      });
      await this.writeTargets(tx, promotion.id, input);
      return promotion;
    });

    return this.get(created.id);
  }

  async update(id: string, input: PromotionInput): Promise<PromotionDetail> {
    await this.assertCodeFree(input.code ?? null, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.promotion.update({ where: { id }, data: this.toData(input) });
      await this.clearTargets(tx, id);
      await this.writeTargets(tx, id, input);
    });

    return this.get(id);
  }

  /**
   * Soft delete. A promotion with usages is history: the P&L attributes discount to it,
   * and deleting the row would leave that money unexplained.
   */
  async remove(id: string): Promise<void> {
    await this.prisma.promotion.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }

  async setActive(id: string, active: boolean): Promise<PromotionDetail> {
    await this.prisma.promotion.update({ where: { id }, data: { active } });
    return this.get(id);
  }

  /**
   * Generates single-use codes — PRD F-AD-20.
   *
   * Codes avoid `0`, `O`, `1` and `I`: they are read off a screenshot and typed by hand,
   * and a code nobody can transcribe is a code nobody uses.
   */
  async generateCodes(
    id: string,
    input: BulkCodeInput,
  ): Promise<{ created: number; codes: string[] }> {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!promotion) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Promotion not found' });

    const codes = new Set<string>();
    // A few extra attempts absorb the collisions a random generator produces; the
    // unique index is what actually guarantees uniqueness.
    for (let attempt = 0; codes.size < input.count && attempt < input.count * 4; attempt += 1) {
      codes.add(`${input.prefix}${randomCode(input.length)}`);
    }

    const result = await this.prisma.promoCode.createMany({
      data: [...codes].map((code) => ({
        promotionId: id,
        code,
        usageLimit: input.usageLimitPerCode,
      })),
      skipDuplicates: true,
    });

    return { created: result.count, codes: [...codes] };
  }

  async listCodes(id: string, limit = 5000): Promise<Array<{ code: string; usageCount: number; usageLimit: number }>> {
    return this.prisma.promoCode.findMany({
      where: { promotionId: id },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 5000),
      select: { code: true, usageCount: true, usageLimit: true },
    });
  }

  // --- simulation and performance -------------------------------------------

  /**
   * Runs the real engine against a real cart — PRD F-AD-21.
   *
   * The same function the storefront calls, so what the owner sees in the simulator is
   * exactly what a shopper would get. A simulator that approximates the engine is worse
   * than none: it builds confidence in a promotion that behaves differently in public.
   */
  async simulate(input: {
    variantIds: Array<{ variantId: string; quantity: number }>;
    codes: string[];
    wilayaCode: number | null;
    customerId: string | null;
    shippingMinor: string;
  }) {
    const variants = await this.prisma.variant.findMany({
      where: { id: { in: input.variantIds.map((line) => line.variantId) } },
      select: {
        id: true,
        sku: true,
        price: true,
        productId: true,
        product: {
          select: {
            name: true,
            categoryId: true,
            collections: { select: { collectionId: true } },
          },
        },
      },
    });

    const lines: CartLine[] = input.variantIds
      .map((line, index) => {
        const variant = variants.find((row) => row.id === line.variantId);
        if (!variant) return null;
        return {
          id: `sim-${index}`,
          variantId: variant.id,
          productId: variant.productId,
          categoryId: variant.product.categoryId,
          collectionIds: variant.product.collections.map((link) => link.collectionId),
          quantity: line.quantity,
          unitPriceMinor: variant.price,
        };
      })
      .filter((line): line is CartLine => line !== null);

    const result = await this.promotions.evaluate({
      lines,
      customerId: input.customerId,
      wilayaCode: input.wilayaCode,
      codes: input.codes,
      shippingMinor: BigInt(input.shippingMinor || '0'),
    });

    return {
      lines: lines.map((line) => {
        const variant = variants.find((row) => row.id === line.variantId)!;
        return {
          id: line.id,
          sku: variant.sku,
          productName: variant.product.name,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor.toString(),
          discountMinor: (
            result.lineDiscounts.find((entry) => entry.lineId === line.id)?.amountMinor ?? 0n
          ).toString(),
        };
      }),
      applied: result.applied.map((entry) => ({
        promotionId: entry.promotionId,
        name: entry.name,
        code: entry.code,
        amountMinor: entry.amountMinor.toString(),
        freeShipping: entry.freeShipping,
      })),
      rejected: result.rejected,
      subtotalMinor: result.subtotalMinor.toString(),
      discountMinor: result.discountMinor.toString(),
      shippingMinor: result.shippingMinor.toString(),
      totalMinor: result.totalMinor.toString(),
    };
  }

  /**
   * What a promotion actually produced — PRD F-AD-21.
   *
   * Revenue counts delivered orders only. A promotion that drove fifty orders of which
   * forty came back has not earned anything, and reporting the gross would say it had.
   */
  async performance(id: string) {
    const usages = await this.prisma.promoUsage.findMany({
      where: { promotionId: id },
      select: {
        amount: true,
        createdAt: true,
        customerId: true,
        order: { select: { total: true, cogsTotal: true, status: true } },
      },
    });

    const delivered = usages.filter((usage) => usage.order?.status === 'DELIVERED');

    const revenue = delivered.reduce((sum, usage) => sum + (usage.order?.total ?? 0n), 0n);
    const cogs = delivered.reduce((sum, usage) => sum + (usage.order?.cogsTotal ?? 0n), 0n);
    const granted = usages.reduce((sum, usage) => sum + usage.amount, 0n);

    const byDay = new Map<string, { uses: number; grantedMinor: bigint }>();
    for (const usage of usages) {
      const day = usage.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { uses: 0, grantedMinor: 0n };
      entry.uses += 1;
      entry.grantedMinor += usage.amount;
      byDay.set(day, entry);
    }

    return {
      uses: usages.length,
      deliveredUses: delivered.length,
      customers: new Set(usages.map((usage) => usage.customerId).filter(Boolean)).size,
      grantedMinor: granted.toString(),
      revenueMinor: revenue.toString(),
      // Revenue less the cost of the goods less what the promotion gave away.
      marginMinor: (revenue - cogs - granted).toString(),
      averageOrderMinor:
        delivered.length === 0 ? '0' : (revenue / BigInt(delivered.length)).toString(),
      series: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, entry]) => ({
          date,
          uses: entry.uses,
          grantedMinor: entry.grantedMinor.toString(),
        })),
    };
  }

  // --- helpers --------------------------------------------------------------

  private toData(input: PromotionInput): Prisma.PromotionUncheckedCreateInput {
    return {
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      scope: input.scope,
      code: input.code ?? null,
      percentOff: input.percentOff ?? null,
      amountOff: input.amountOff ?? null,
      bundlePrice: input.bundlePrice ?? null,
      buyXGetY: (input.buyXGetY ?? Prisma.DbNull) as Prisma.InputJsonValue,
      tiers: input.tiers.map((tier) => ({
        minSubtotal: tier.minSubtotal.toString(),
        percentOff: tier.percentOff,
      })) as unknown as Prisma.InputJsonValue,
      minSubtotal: input.conditions.minSubtotal ?? null,
      minQuantity: input.conditions.minQuantity ?? null,
      firstOrderOnly: input.conditions.firstOrderOnly,
      wilayaCodes: input.conditions.wilayaCodes,
      usageLimitTotal: input.usageLimitTotal ?? null,
      usageLimitPerCustomer: input.usageLimitPerCustomer ?? null,
      stackable: input.stackable,
      priority: input.priority,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      active: input.active,
      showCountdown: input.showCountdown,
    };
  }

  private async writeTargets(
    tx: Prisma.TransactionClient,
    promotionId: string,
    input: PromotionInput,
  ): Promise<void> {
    const { conditions } = input;

    if (conditions.productIds.length > 0) {
      await tx.promotionProduct.createMany({
        data: conditions.productIds.map((productId) => ({ promotionId, productId })),
        skipDuplicates: true,
      });
    }
    if (conditions.variantIds.length > 0) {
      await tx.promotionVariant.createMany({
        data: conditions.variantIds.map((variantId) => ({ promotionId, variantId })),
        skipDuplicates: true,
      });
    }
    if (conditions.collectionIds.length > 0) {
      await tx.promotionCollection.createMany({
        data: conditions.collectionIds.map((collectionId) => ({ promotionId, collectionId })),
        skipDuplicates: true,
      });
    }
    if (conditions.categoryIds.length > 0) {
      await tx.promotionCategory.createMany({
        data: conditions.categoryIds.map((categoryId) => ({ promotionId, categoryId })),
        skipDuplicates: true,
      });
    }
    if (conditions.customerGroupIds.length > 0) {
      await tx.promotionCustomerGroup.createMany({
        data: conditions.customerGroupIds.map((groupId) => ({ promotionId, groupId })),
        skipDuplicates: true,
      });
    }
  }

  private async clearTargets(tx: Prisma.TransactionClient, promotionId: string): Promise<void> {
    await Promise.all([
      tx.promotionProduct.deleteMany({ where: { promotionId } }),
      tx.promotionVariant.deleteMany({ where: { promotionId } }),
      tx.promotionCollection.deleteMany({ where: { promotionId } }),
      tx.promotionCategory.deleteMany({ where: { promotionId } }),
      tx.promotionCustomerGroup.deleteMany({ where: { promotionId } }),
    ]);
  }

  private async assertCodeFree(code: string | null, exceptId?: string): Promise<void> {
    if (!code) return;
    const clash = await this.prisma.promotion.findFirst({
      where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException({
        code: 'ALREADY_EXISTS',
        message: `The code "${code}" is already used by another promotion`,
        details: { field: 'code' },
      });
    }
  }

  private async grantedByPromotion(ids: string[]): Promise<Map<string, bigint>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.prisma.promoUsage.groupBy({
      by: ['promotionId'],
      where: { promotionId: { in: ids } },
      _sum: { amount: true },
    });
    return new Map(grouped.map((row) => [row.promotionId, row._sum.amount ?? 0n]));
  }

  private buildWhere(
    query: AdminListQuery,
    filters: { type?: string[] },
  ): Prisma.PromotionWhereInput {
    const term = query.q?.trim();
    return andWhere(
      { deletedAt: null },
      filters.type?.length
        ? { type: { in: filters.type as Prisma.EnumPromotionTypeFilter['in'] } }
        : undefined,
      term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { code: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
    ) as Prisma.PromotionWhereInput;
  }
}

/** Where a promotion stands right now, which is not the same as its `active` flag. */
function stateOf(row: PromotionRecord, now = new Date()): PromotionRow['state'] {
  if (!row.active) return 'draft';
  if (row.usageLimitTotal !== null && row.usageCount >= row.usageLimitTotal) return 'exhausted';
  if (row.startsAt && now < row.startsAt) return 'scheduled';
  if (row.endsAt && now > row.endsAt) return 'expired';
  return 'active';
}

function toRow(row: PromotionRecord, granted: bigint): PromotionRow {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type as PromotionType,
    scope: row.scope,
    state: stateOf(row),
    percentOff: row.percentOff === null ? null : Number(row.percentOff),
    amountOffMinor: row.amountOff?.toString() ?? null,
    usageCount: row.usageCount,
    usageLimitTotal: row.usageLimitTotal,
    codeCount: row._count.codes,
    grantedMinor: granted.toString(),
    stackable: row.stackable,
    priority: row.priority,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: PromotionRecord, granted: bigint): PromotionDetail {
  const rule = toRule(row);
  return {
    ...toRow(row, granted),
    description: row.description,
    bundlePriceMinor: row.bundlePrice?.toString() ?? null,
    buyXGetY: rule.buyXGetY,
    tiers: rule.tiers.map((tier) => ({
      minSubtotalMinor: tier.minSubtotalMinor.toString(),
      percentOff: tier.percentOff,
    })),
    minSubtotalMinor: row.minSubtotal?.toString() ?? null,
    minQuantity: row.minQuantity,
    firstOrderOnly: row.firstOrderOnly,
    wilayaCodes: row.wilayaCodes,
    productIds: rule.productIds,
    variantIds: rule.variantIds,
    collectionIds: rule.collectionIds,
    categoryIds: rule.categoryIds,
    customerGroupIds: rule.customerGroupIds,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    showCountdown: row.showCountdown,
  };
}

/**
 * Ambiguity-free alphabet: no `0`/`O`, no `1`/`I`. These codes are read off a
 * screenshot on a phone and typed by hand.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[bytes[index]! % ALPHABET.length];
  }
  return out;
}

export const PROMOTION_EXPORT_COLUMNS: ExportColumn<PromotionRow>[] = [
  { header: 'Nom', value: (row) => row.name, width: 32 },
  { header: 'Code', value: (row) => row.code ?? 'automatique', width: 18 },
  { header: 'Type', value: (row) => row.type, width: 18 },
  { header: 'État', value: (row) => row.state, width: 14 },
  { header: 'Utilisations', value: (row) => row.usageCount },
  { header: 'Limite', value: (row) => row.usageLimitTotal ?? '' },
  { header: 'Codes uniques', value: (row) => row.codeCount },
  { header: 'Remise accordée (DA)', value: (row) => Number(row.grantedMinor) / 100 },
  { header: 'Priorité', value: (row) => row.priority },
  { header: 'Début', value: (row) => (row.startsAt ? new Date(row.startsAt) : '') },
  { header: 'Fin', value: (row) => (row.endsAt ? new Date(row.endsAt) : '') },
];
