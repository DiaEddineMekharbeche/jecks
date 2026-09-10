import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@jecks/db';
import {
  FINANCE_ERRORS,
  MAX_REPORT_DAYS,
  addPnl,
  allocateByRevenue,
  changePercent,
  computePnl,
  emptyPnl,
  t,
  type PnlInput,
  type PnlGroupRow,
  type PnlGrouping,
  type PnlLine,
  type PnlQuery,
  type PnlReport,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Profit and loss — PRD F-AD-70.
 *
 * Two decisions shape every number here.
 *
 * **What counts as a sale.** Delivered by default, because in a cash-on-delivery market
 * a placed order is a request: counting it as revenue makes a shop with a 60 % delivery
 * rate look twice as profitable as it is. `finance.revenue_basis` can switch it to
 * "paid" for a shop that trades mostly online, and the answer says which basis it used.
 *
 * **When it counts.** On the day it was delivered, not the day it was placed. That is
 * when the money and the goods actually moved.
 *
 * The arithmetic itself is pure and lives in `domain/pnl`; this service only decides
 * which rows go in.
 */
@Injectable()
export class PnlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async report(query: PnlQuery): Promise<PnlReport> {
    const from = startOfDay(query.from);
    const to = startOfDay(query.to);

    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > MAX_REPORT_DAYS) {
      throw new BadRequestException({
        code: FINANCE_ERRORS.PERIOD_TOO_LONG,
        message: `Une période ne peut pas dépasser ${MAX_REPORT_DAYS} jours.`,
      });
    }

    const basis = ((await this.settings.get<string>('finance.revenue_basis', 'delivered')) ===
    'paid'
      ? 'paid'
      : 'delivered') as 'delivered' | 'paid';

    const current = await this.compute(from, to, query.groupBy, basis);

    if (!query.compare) return current;

    // The same span immediately before, so "up on last month" means something exact.
    const previousTo = new Date(from.getTime() - 86_400_000);
    const previousFrom = new Date(previousTo.getTime() - (days - 1) * 86_400_000);
    const previous = await this.compute(previousFrom, previousTo, query.groupBy, basis);

    return {
      ...current,
      previous: {
        ...stripRows(previous),
        from: previousFrom.toISOString().slice(0, 10),
        to: previousTo.toISOString().slice(0, 10),
      },
      changes: {
        revenuePercent: changePercent(BigInt(current.revenueMinor), BigInt(previous.revenueMinor)),
        netProfitPercent: changePercent(
          BigInt(current.netProfitMinor),
          BigInt(previous.netProfitMinor),
        ),
        ordersPercent: changePercent(BigInt(current.orders), BigInt(previous.orders)),
      },
    };
  }

  private async compute(
    from: Date,
    to: Date,
    groupBy: PnlGrouping,
    basis: 'delivered' | 'paid',
  ): Promise<PnlReport> {
    const end = new Date(to.getTime() + 86_400_000);

    const orders = await this.prisma.order.findMany({
      where:
        basis === 'paid'
          ? { deletedAt: null, paymentStatus: 'PAID', createdAt: { gte: from, lt: end } }
          : {
              deletedAt: null,
              status: { in: [OrderStatus.DELIVERED] },
              deliveredAt: { gte: from, lt: end },
            },
      select: {
        id: true,
        itemsSubtotal: true,
        discountTotal: true,
        shippingTotal: true,
        shippingCost: true,
        cogsTotal: true,
        refundedTotal: true,
        itemCount: true,
        wilayaCode: true,
        wilayaName: true,
        source: true,
        deliveredAt: true,
        createdAt: true,
        payments: { select: { feeAmount: true } },
        shipments: { select: { courierId: true, courier: { select: { name: true } } } },
        items: {
          select: {
            quantity: true,
            lineTotal: true,
            unitCost: true,
            productName: true,
            variant: {
              select: {
                productId: true,
                product: {
                  select: {
                    name: true,
                    categoryId: true,
                    category: { select: { name: true } },
                    collections: { select: { collection: { select: { id: true, name: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const [expenses, adSpend] = await Promise.all([
      this.prisma.expense.aggregate({
        where: { deletedAt: null, incurredAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      this.prisma.adSpend.aggregate({
        where: { spentOn: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
    ]);

    const expensesMinor = expenses._sum.amount ?? 0n;
    const adSpendMinor = adSpend._sum.amount ?? 0n;

    // --- totals -------------------------------------------------------------
    let totals = emptyPnl();
    let units = 0;

    for (const order of orders) {
      totals = addPnl(totals, orderLine(order));
      units += order.itemCount;
    }

    totals = { ...totals, expensesMinor, adSpendMinor };
    const computed = computePnl(totals);

    // --- groups -------------------------------------------------------------
    const groups = new Map<string, { label: string; pnl: PnlInput; orders: number; units: number }>();

    const push = (key: string, label: string, pnl: PnlInput, orderUnits: number, whole: boolean) => {
      const entry = groups.get(key) ?? { label, pnl: emptyPnl(), orders: 0, units: 0 };
      entry.pnl = addPnl(entry.pnl, pnl);
      entry.units += orderUnits;
      // An order split across products must not be counted once per line.
      if (whole) entry.orders += 1;
      groups.set(key, entry);
    };

    for (const order of orders) {
      const line = orderLine(order);

      switch (groupBy) {
        case 'day':
        case 'week':
        case 'month': {
          const when = order.deliveredAt ?? order.createdAt;
          const key = periodKey(when, groupBy);
          push(key, key, line, order.itemCount, true);
          break;
        }
        case 'wilaya':
          push(String(order.wilayaCode), order.wilayaName, line, order.itemCount, true);
          break;
        case 'channel':
          push(order.source, order.source, line, order.itemCount, true);
          break;
        case 'courier': {
          const courier = order.shipments[0]?.courier;
          push(
            order.shipments[0]?.courierId ?? 'fleet',
            courier?.name ?? 'Flotte interne',
            line,
            order.itemCount,
            true,
          );
          break;
        }
        case 'product':
        case 'category':
        case 'collection': {
          // Per-line groupings split the order across its items, so the order-level
          // figures (delivery, refunds) are spread by line value rather than repeated.
          const lineTotal = order.items.reduce((sum, item) => sum + item.lineTotal, 0n);

          for (const item of order.items) {
            const share = lineTotal === 0n ? 0n : (item.lineTotal * 1000n) / lineTotal;
            const scale = (value: bigint) => (share === 0n ? 0n : (value * share) / 1000n);

            const itemPnl: PnlInput = {
              revenueMinor: item.lineTotal,
              cogsMinor: item.unitCost * BigInt(item.quantity),
              shippingRevenueMinor: scale(order.shippingTotal),
              shippingCostMinor: scale(order.shippingCost),
              discountsMinor: scale(order.discountTotal),
              paymentFeesMinor: scale(paymentFees(order)),
              refundsMinor: scale(order.refundedTotal),
              expensesMinor: 0n,
              adSpendMinor: 0n,
            };

            const keys = groupKeysFor(groupBy, item);
            for (const { key, label } of keys) push(key, label, itemPnl, item.quantity, false);
          }
          break;
        }
      }
    }

    // Period-wide costs belong to the whole, so they are spread across the groups by
    // revenue rather than left out of every row.
    const overheads = allocateByRevenue(
      expensesMinor + adSpendMinor,
      [...groups.entries()].map(([key, entry]) => ({ key, revenueMinor: entry.pnl.revenueMinor })),
    );

    const rows: PnlGroupRow[] = [...groups.entries()]
      .map(([key, entry]) => {
        const share = overheads.get(key) ?? 0n;
        // Split back into the two lines in the same proportion they arrived.
        const total = expensesMinor + adSpendMinor;
        const expenseShare = total === 0n ? 0n : (share * expensesMinor) / total;

        const withOverheads: PnlInput = {
          ...entry.pnl,
          expensesMinor: expenseShare,
          adSpendMinor: share - expenseShare,
        };

        return {
          key,
          label: entry.label,
          orders: entry.orders,
          units: entry.units,
          ...serialise(computePnl(withOverheads)),
        };
      })
      .sort((a, b) => Number(BigInt(b.revenueMinor) - BigInt(a.revenueMinor)));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      groupBy,
      basis,
      orders: orders.length,
      units,
      rows,
      ...serialise(computed),
    };
  }
}

/** One order's contribution, before period-wide costs are shared out. */
function orderLine(order: {
  itemsSubtotal: bigint;
  discountTotal: bigint;
  shippingTotal: bigint;
  shippingCost: bigint;
  cogsTotal: bigint;
  refundedTotal: bigint;
  payments: Array<{ feeAmount: bigint }>;
}): PnlInput {
  return {
    // Revenue is already net of the discount; the discount is reported, not subtracted.
    revenueMinor: order.itemsSubtotal - order.discountTotal,
    cogsMinor: order.cogsTotal,
    shippingRevenueMinor: order.shippingTotal,
    shippingCostMinor: order.shippingCost,
    discountsMinor: order.discountTotal,
    paymentFeesMinor: paymentFees(order),
    refundsMinor: order.refundedTotal,
    expensesMinor: 0n,
    adSpendMinor: 0n,
  };
}

function paymentFees(order: { payments: Array<{ feeAmount: bigint }> }): bigint {
  return order.payments.reduce((sum, payment) => sum + payment.feeAmount, 0n);
}

type GroupableItem = {
  productName: unknown;
  variant: {
    productId: string;
    product: {
      name: unknown;
      categoryId: string | null;
      category: { name: unknown } | null;
      collections: Array<{ collection: { id: string; name: unknown } }>;
    };
  } | null;
};

/**
 * The groups one order line belongs to.
 *
 * A product is in one category and any number of collections, so grouping by collection
 * legitimately counts a line more than once. The order count is not incremented for
 * these groupings, which is why the row totals can exceed the report total and the
 * order column does not.
 */
function groupKeysFor(
  groupBy: PnlGrouping,
  item: GroupableItem,
): Array<{ key: string; label: string }> {
  if (groupBy === 'product') {
    const productId = item.variant?.productId;
    if (!productId) return [{ key: 'unknown', label: 'Produit supprimé' }];
    return [
      {
        key: productId,
        label: t((item.variant!.product.name ?? item.productName) as Translated, 'fr'),
      },
    ];
  }

  if (groupBy === 'category') {
    const categoryId = item.variant?.product.categoryId;
    if (!categoryId) return [{ key: 'none', label: 'Sans catégorie' }];
    return [
      { key: categoryId, label: t(item.variant!.product.category!.name as Translated, 'fr') },
    ];
  }

  const collections = item.variant?.product.collections ?? [];
  if (collections.length === 0) return [{ key: 'none', label: 'Hors collection' }];

  return collections.map((entry) => ({
    key: entry.collection.id,
    label: t(entry.collection.name as Translated, 'fr'),
  }));
}

/** ISO day, ISO week or month, as the label the chart will show. */
function periodKey(date: Date, grouping: 'day' | 'week' | 'month'): string {
  if (grouping === 'day') return date.toISOString().slice(0, 10);
  if (grouping === 'month') return date.toISOString().slice(0, 7);

  // ISO week: Thursday decides the year, which is what makes late December land right.
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );

  return `${target.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

function serialise(result: ReturnType<typeof computePnl>): PnlLine {
  return {
    revenueMinor: result.revenueMinor.toString(),
    cogsMinor: result.cogsMinor.toString(),
    shippingRevenueMinor: result.shippingRevenueMinor.toString(),
    shippingCostMinor: result.shippingCostMinor.toString(),
    discountsMinor: result.discountsMinor.toString(),
    paymentFeesMinor: result.paymentFeesMinor.toString(),
    refundsMinor: result.refundsMinor.toString(),
    expensesMinor: result.expensesMinor.toString(),
    adSpendMinor: result.adSpendMinor.toString(),
    grossProfitMinor: result.grossProfitMinor.toString(),
    shippingMarginMinor: result.shippingMarginMinor.toString(),
    contributionMinor: result.contributionMinor.toString(),
    netProfitMinor: result.netProfitMinor.toString(),
    grossMarginPercent: result.grossMarginPercent,
    netMarginPercent: result.netMarginPercent,
  };
}

function stripRows(report: PnlReport): PnlLine {
  const { rows: _rows, ...line } = report;
  return line as PnlLine;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const PNL_EXPORT_COLUMNS = [
  { header: 'Groupe', value: (row: PnlGroupRow) => row.label },
  { header: 'Commandes', value: (row: PnlGroupRow) => row.orders },
  { header: 'Unités', value: (row: PnlGroupRow) => row.units },
  { header: 'CA (DA)', value: (row: PnlGroupRow) => Number(row.revenueMinor) / 100 },
  { header: 'Coût marchandises (DA)', value: (row: PnlGroupRow) => Number(row.cogsMinor) / 100 },
  { header: 'Marge brute (DA)', value: (row: PnlGroupRow) => Number(row.grossProfitMinor) / 100 },
  { header: 'Marge brute (%)', value: (row: PnlGroupRow) => row.grossMarginPercent },
  { header: 'Livraison nette (DA)', value: (row: PnlGroupRow) => Number(row.shippingMarginMinor) / 100 },
  { header: 'Frais paiement (DA)', value: (row: PnlGroupRow) => Number(row.paymentFeesMinor) / 100 },
  { header: 'Remboursements (DA)', value: (row: PnlGroupRow) => Number(row.refundsMinor) / 100 },
  { header: 'Charges (DA)', value: (row: PnlGroupRow) => Number(row.expensesMinor) / 100 },
  { header: 'Publicité (DA)', value: (row: PnlGroupRow) => Number(row.adSpendMinor) / 100 },
  { header: 'Résultat net (DA)', value: (row: PnlGroupRow) => Number(row.netProfitMinor) / 100 },
];
