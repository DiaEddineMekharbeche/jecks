import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  costPerOrder,
  roas,
  type AdSpendInput,
  type AdSpendRow,
  type AdSpendSummary,
  type AdminListQuery,
  type LedgerAccount,
  type LedgerBalances,
  type LedgerEntryInput,
  type LedgerKind,
  type LedgerRow,
  type AdPlatform,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The payments ledger and ad spend — PRD F-AD-72 and F-AD-73.
 *
 * Every movement of money gets a signed row: positive is in, negative is out. The
 * balance of an account is the sum of its rows and is never stored, so a balance cannot
 * drift away from the entries that explain it.
 *
 * Four accounts, which is how a small shop actually thinks: cash in the drawer, money at
 * the bank, money a courier is holding, and money owed by a customer.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  // --- ledger ---------------------------------------------------------------

  async list(query: AdminListQuery, filters: Record<string, string[]>) {
    const where = this.whereFrom(query, filters);

    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: { occurredAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { order: { select: { number: true } } },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toRow(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async listForExport(query: AdminListQuery, filters: Record<string, string[]>) {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: this.whereFrom(query, filters),
      orderBy: { occurredAt: 'desc' },
      take: 50_000,
      include: { order: { select: { number: true } } },
    });
    return rows.map((row) => this.toRow(row));
  }

  /** Balances per account, derived rather than stored. */
  async balances(): Promise<LedgerBalances> {
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['account'],
      _sum: { amount: true },
      _count: { _all: true },
    });

    const order: LedgerAccount[] = ['cash', 'bank', 'courier', 'customer'];
    const byAccount = new Map(grouped.map((row) => [row.account, row]));

    const accounts = order.map((account) => {
      const row = byAccount.get(account);
      return {
        account,
        balanceMinor: (row?._sum.amount ?? 0n).toString(),
        entryCount: row?._count._all ?? 0,
      };
    });

    const totalMinor = grouped.reduce((sum, row) => sum + (row._sum.amount ?? 0n), 0n);
    return { accounts, totalMinor: totalMinor.toString() };
  }

  /**
   * A manual entry, for the movements no automatic hook can see.
   *
   * Money taken out of the till for petrol is real and nothing else will record it.
   */
  async create(input: LedgerEntryInput): Promise<LedgerRow> {
    const entry = await this.prisma.ledgerEntry.create({
      data: {
        kind: input.kind,
        account: input.account,
        amount: input.amount,
        orderId: input.orderId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        note: input.note ?? null,
        referenceType: 'manual',
      },
      include: { order: { select: { number: true } } },
    });

    return this.toRow(entry);
  }

  // --- ad spend -------------------------------------------------------------

  async listAdSpend(from: Date, to: Date): Promise<AdSpendRow[]> {
    const rows = await this.prisma.adSpend.findMany({
      where: { spentOn: { gte: startOfDay(from), lte: startOfDay(to) } },
      orderBy: [{ spentOn: 'desc' }, { platform: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      platform: row.platform as AdPlatform,
      campaign: row.campaign,
      spentOn: row.spentOn.toISOString().slice(0, 10),
      amountMinor: row.amount.toString(),
      impressions: row.impressions,
      clicks: row.clicks,
      note: row.note,
    }));
  }

  /**
   * Upserts a day's spend for a platform and campaign.
   *
   * Typed in from an ads dashboard, and typed in again when the number is corrected, so
   * the same day and campaign replaces rather than duplicates.
   */
  async saveAdSpend(input: AdSpendInput): Promise<AdSpendRow> {
    const spentOn = startOfDay(input.spentOn);

    const row = await this.prisma.adSpend.upsert({
      where: {
        platform_campaign_spentOn: {
          platform: input.platform,
          campaign: input.campaign ?? '',
          spentOn,
        },
      },
      create: {
        platform: input.platform,
        campaign: input.campaign ?? '',
        spentOn,
        amount: input.amount,
        impressions: input.impressions ?? null,
        clicks: input.clicks ?? null,
        note: input.note ?? null,
      },
      update: {
        amount: input.amount,
        impressions: input.impressions ?? null,
        clicks: input.clicks ?? null,
        note: input.note ?? null,
      },
    });

    return {
      id: row.id,
      platform: row.platform as AdPlatform,
      campaign: row.campaign,
      spentOn: row.spentOn.toISOString().slice(0, 10),
      amountMinor: row.amount.toString(),
      impressions: row.impressions,
      clicks: row.clicks,
      note: row.note,
    };
  }

  async removeAdSpend(id: string): Promise<void> {
    await this.prisma.adSpend.deleteMany({ where: { id } });
  }

  /**
   * What the advertising bought — PRD F-AD-73.
   *
   * Orders are attributed by the UTM source recorded on the order at checkout. That is
   * last-click attribution and it is imperfect, but it is the only signal the shop
   * actually holds, and a made-up model would be worse.
   */
  async adSpendSummary(from: Date, to: Date): Promise<AdSpendSummary> {
    const start = startOfDay(from);
    const end = startOfDay(to);
    const endExclusive = new Date(end.getTime() + 86_400_000);

    const [spend, orders] = await Promise.all([
      this.prisma.adSpend.findMany({ where: { spentOn: { gte: start, lte: end } } }),
      this.prisma.order.findMany({
        where: { deletedAt: null, deliveredAt: { gte: start, lt: endExclusive } },
        select: { total: true, utmSource: true, deliveredAt: true },
      }),
    ]);

    const byPlatform = new Map<
      string,
      { amount: bigint; impressions: number; clicks: number; orders: number; revenue: bigint }
    >();

    for (const row of spend) {
      const entry = byPlatform.get(row.platform) ?? {
        amount: 0n,
        impressions: 0,
        clicks: 0,
        orders: 0,
        revenue: 0n,
      };
      entry.amount += row.amount;
      entry.impressions += row.impressions ?? 0;
      entry.clicks += row.clicks ?? 0;
      byPlatform.set(row.platform, entry);
    }

    for (const order of orders) {
      const platform = normalisePlatform(order.utmSource);
      if (!platform) continue;
      const entry = byPlatform.get(platform);
      if (!entry) continue;
      entry.orders += 1;
      entry.revenue += order.total;
    }

    const totalSpend = spend.reduce((sum, row) => sum + row.amount, 0n);
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0n);

    // Daily series, so the chart has an entry for a day nothing was spent.
    const series = new Map<string, { date: string; amount: bigint; revenue: bigint }>();
    for (let day = new Date(start); day <= end; day = new Date(day.getTime() + 86_400_000)) {
      const key = day.toISOString().slice(0, 10);
      series.set(key, { date: key, amount: 0n, revenue: 0n });
    }
    for (const row of spend) {
      const entry = series.get(row.spentOn.toISOString().slice(0, 10));
      if (entry) entry.amount += row.amount;
    }
    for (const order of orders) {
      const entry = series.get(order.deliveredAt!.toISOString().slice(0, 10));
      if (entry) entry.revenue += order.total;
    }

    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      totalMinor: totalSpend.toString(),
      orders: orders.length,
      revenueMinor: totalRevenue.toString(),
      roas: roas(totalRevenue, totalSpend),
      costPerOrderMinor: costPerOrder(totalSpend, orders.length)?.toString() ?? null,
      byPlatform: [...byPlatform.entries()]
        .map(([platform, entry]) => ({
          platform: platform as AdPlatform,
          amountMinor: entry.amount.toString(),
          impressions: entry.impressions,
          clicks: entry.clicks,
          orders: entry.orders,
          revenueMinor: entry.revenue.toString(),
          roas: roas(entry.revenue, entry.amount),
        }))
        .sort((a, b) => Number(BigInt(b.amountMinor) - BigInt(a.amountMinor))),
      series: [...series.values()].map((entry) => ({
        date: entry.date,
        amountMinor: entry.amount.toString(),
        revenueMinor: entry.revenue.toString(),
      })),
    };
  }

  private whereFrom(
    query: AdminListQuery,
    filters: Record<string, string[]>,
  ): Prisma.LedgerEntryWhereInput {
    return {
      ...(filters.kind?.length ? { kind: { in: filters.kind } } : {}),
      ...(filters.account?.length ? { account: { in: filters.account } } : {}),
      ...(filters.from?.[0] || filters.to?.[0]
        ? {
            occurredAt: {
              ...(filters.from?.[0] ? { gte: new Date(filters.from[0]) } : {}),
              ...(filters.to?.[0] ? { lte: new Date(filters.to[0]) } : {}),
            },
          }
        : {}),
      ...(query.q?.trim() ? { order: { number: { contains: query.q.trim(), mode: 'insensitive' } } } : {}),
    };
  }

  private toRow(entry: {
    id: string;
    kind: string;
    account: string;
    amount: bigint;
    orderId: string | null;
    referenceType: string | null;
    occurredAt: Date;
    note: string | null;
    order: { number: string } | null;
  }): LedgerRow {
    return {
      id: entry.id,
      kind: entry.kind as LedgerKind,
      account: entry.account as LedgerAccount,
      amountMinor: entry.amount.toString(),
      orderId: entry.orderId,
      orderNumber: entry.order?.number ?? null,
      referenceType: entry.referenceType,
      occurredAt: entry.occurredAt.toISOString(),
      note: entry.note,
    };
  }
}

/**
 * Maps a UTM source to a platform we bought ads on.
 *
 * Anything unrecognised returns null rather than being lumped into "other": crediting
 * organic traffic to an ad budget is how a campaign looks profitable when it is not.
 */
export function normalisePlatform(utmSource: string | null): AdPlatform | null {
  const source = utmSource?.trim().toLowerCase();
  if (!source) return null;

  if (source.includes('facebook') || source === 'fb') return 'facebook';
  if (source.includes('instagram') || source === 'ig') return 'instagram';
  if (source.includes('tiktok')) return 'tiktok';
  if (source.includes('google') || source.includes('adwords')) return 'google';
  return null;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const LEDGER_EXPORT_COLUMNS = [
  { header: 'Date', value: (row: LedgerRow) => row.occurredAt.slice(0, 10) },
  { header: 'Type', value: (row: LedgerRow) => row.kind },
  { header: 'Compte', value: (row: LedgerRow) => row.account },
  { header: 'Commande', value: (row: LedgerRow) => row.orderNumber ?? '' },
  { header: 'Montant (DA)', value: (row: LedgerRow) => Number(row.amountMinor) / 100 },
  { header: 'Note', value: (row: LedgerRow) => row.note ?? '' },
];
