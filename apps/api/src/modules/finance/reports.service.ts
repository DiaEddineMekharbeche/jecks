import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@jecks/db';
import {
  FINANCE_ERRORS,
  t,
  type ReportColumn,
  type ReportKey,
  type ReportQuery,
  type ReportResult,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The report library — PRD Section 5.9, F-AD-80/81.
 *
 * Every report is a named function that returns columns and rows. Named rather than
 * free-form on purpose: a report key is a contract with the export job and with whoever
 * scheduled it, and a query builder that takes arbitrary conditions is a different
 * product with a different security model.
 *
 * Sales reports count *delivered* orders. In a cash-on-delivery market a placed order
 * is a request, and a "best sellers" list built from requests recommends restocking the
 * products customers most often refuse at the door.
 */

const MONEY: ReportColumn['type'] = 'money';

/**
 * The filename stem for a report, without the date.
 *
 * `sales.by_product` becomes `sales-by-product`. Shared by the streamed download and
 * the queued export so the same report does not arrive under two different names
 * depending on which button was pressed.
 */
export function exportBaseName(key: string): string {
  return key.replace(/[._]/g, '-');
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every report, with its title, for the library screen. */
  catalogue(): Array<{ key: ReportKey; title: string; group: string }> {
    return [
      { key: 'sales.by_product', title: 'Ventes par produit', group: 'Ventes' },
      { key: 'sales.by_variant', title: 'Ventes par variante', group: 'Ventes' },
      { key: 'sales.by_category', title: 'Ventes par catégorie', group: 'Ventes' },
      { key: 'sales.by_collection', title: 'Ventes par collection', group: 'Ventes' },
      { key: 'sales.by_period', title: 'Ventes par période', group: 'Ventes' },
      { key: 'sales.by_wilaya', title: 'Ventes par wilaya', group: 'Ventes' },
      { key: 'sales.by_courier', title: 'Ventes par transporteur', group: 'Ventes' },
      { key: 'sales.by_source', title: 'Ventes par canal', group: 'Ventes' },
      { key: 'sales.by_agent', title: 'Ventes par agent', group: 'Ventes' },
      { key: 'inventory.valuation', title: 'Valorisation du stock', group: 'Stock' },
      { key: 'inventory.ageing', title: 'Ancienneté du stock', group: 'Stock' },
      { key: 'inventory.stockouts', title: 'Ventes perdues sur rupture', group: 'Stock' },
      { key: 'customers.cohorts', title: 'Cohortes de clients', group: 'Clients' },
      { key: 'customers.retention', title: 'Rétention', group: 'Clients' },
      { key: 'promotions.performance', title: 'Performance des promotions', group: 'Marketing' },
      { key: 'search.zero_results', title: 'Recherches sans résultat', group: 'Marketing' },
      { key: 'funnel.conversion', title: 'Entonnoir de conversion', group: 'Marketing' },
    ];
  }

  async run(key: ReportKey, query: ReportQuery): Promise<ReportResult> {
    const to = startOfDay(query.to ?? new Date());
    const from = startOfDay(query.from ?? new Date(to.getTime() - 29 * 86_400_000));
    const range = { from, to, limit: query.limit };

    const runner = this.runners()[key];
    if (!runner) {
      throw new BadRequestException({
        code: FINANCE_ERRORS.UNKNOWN_REPORT,
        message: `Rapport inconnu : ${key}`,
      });
    }

    const result = await runner(range);
    const title = this.catalogue().find((entry) => entry.key === key)?.title ?? key;

    return {
      key,
      title,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      truncated: result.rows.length >= query.limit,
      ...result,
    };
  }

  private runners(): Record<
    ReportKey,
    (range: Range) => Promise<Omit<ReportResult, 'key' | 'title' | 'from' | 'to' | 'truncated'>>
  > {
    return {
      'sales.by_product': (range) => this.salesByItem(range, 'product'),
      'sales.by_variant': (range) => this.salesByItem(range, 'variant'),
      'sales.by_category': (range) => this.salesByItem(range, 'category'),
      'sales.by_collection': (range) => this.salesByItem(range, 'collection'),
      'sales.by_period': (range) => this.salesByPeriod(range),
      'sales.by_wilaya': (range) => this.salesByOrderField(range, 'wilaya'),
      'sales.by_source': (range) => this.salesByOrderField(range, 'source'),
      'sales.by_agent': (range) => this.salesByOrderField(range, 'agent'),
      'sales.by_courier': (range) => this.salesByCourier(range),
      'inventory.valuation': () => this.inventoryValuation(),
      'inventory.ageing': (range) => this.inventoryAgeing(range),
      'inventory.stockouts': (range) => this.stockouts(range),
      'customers.cohorts': (range) => this.cohorts(range),
      'customers.retention': (range) => this.retention(range),
      'promotions.performance': (range) => this.promotionPerformance(range),
      'search.zero_results': (range) => this.zeroResults(range),
      'funnel.conversion': (range) => this.funnel(range),
    };
  }

  // --- sales ----------------------------------------------------------------

  private async salesByItem(range: Range, level: 'product' | 'variant' | 'category' | 'collection') {
    const items = await this.prisma.orderItem.findMany({
      where: { order: deliveredIn(range) },
      select: {
        quantity: true,
        lineTotal: true,
        unitCost: true,
        sku: true,
        productName: true,
        variantName: true,
        variant: {
          select: {
            id: true,
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
    });

    const groups = new Map<string, { label: string; units: number; revenue: bigint; cost: bigint }>();

    const add = (key: string, label: string, quantity: number, revenue: bigint, cost: bigint) => {
      const entry = groups.get(key) ?? { label, units: 0, revenue: 0n, cost: 0n };
      entry.units += quantity;
      entry.revenue += revenue;
      entry.cost += cost;
      groups.set(key, entry);
    };

    for (const item of items) {
      const cost = item.unitCost * BigInt(item.quantity);

      if (level === 'variant') {
        add(item.variant?.id ?? item.sku, `${item.sku} — ${label(item.productName)}${item.variantName ? ` (${item.variantName})` : ''}`, item.quantity, item.lineTotal, cost);
      } else if (level === 'product') {
        add(
          item.variant?.productId ?? item.sku,
          label(item.variant?.product.name ?? item.productName),
          item.quantity,
          item.lineTotal,
          cost,
        );
      } else if (level === 'category') {
        const category = item.variant?.product.category;
        add(
          item.variant?.product.categoryId ?? 'none',
          category ? label(category.name) : 'Sans catégorie',
          item.quantity,
          item.lineTotal,
          cost,
        );
      } else {
        const collections = item.variant?.product.collections ?? [];
        if (collections.length === 0) {
          add('none', 'Hors collection', item.quantity, item.lineTotal, cost);
        }
        for (const entry of collections) {
          add(
            entry.collection.id,
            label(entry.collection.name),
            item.quantity,
            item.lineTotal,
            cost,
          );
        }
      }
    }

    const rows = [...groups.values()]
      .sort((a, b) => Number(b.revenue - a.revenue))
      .slice(0, range.limit)
      .map((entry) => ({
        label: entry.label,
        units: entry.units,
        revenue: Number(entry.revenue) / 100,
        cost: Number(entry.cost) / 100,
        margin: Number(entry.revenue - entry.cost) / 100,
        marginPercent:
          entry.revenue === 0n
            ? 0
            : Math.round(Number(((entry.revenue - entry.cost) * 1000n) / entry.revenue)) / 10,
      }));

    return {
      columns: [
        { key: 'label', label: 'Article', type: 'text' as const },
        { key: 'units', label: 'Unités', type: 'number' as const },
        { key: 'revenue', label: 'CA', type: MONEY },
        { key: 'cost', label: 'Coût', type: MONEY },
        { key: 'margin', label: 'Marge', type: MONEY },
        { key: 'marginPercent', label: 'Marge %', type: 'percent' as const },
      ],
      rows,
      series: rows.slice(0, 12).map((row) => ({ label: row.label, value: row.revenue })),
    };
  }

  private async salesByPeriod(range: Range) {
    const orders = await this.prisma.order.findMany({
      where: deliveredIn(range),
      select: { total: true, cogsTotal: true, itemCount: true, deliveredAt: true },
    });

    const byDay = new Map<string, { orders: number; units: number; revenue: bigint; cost: bigint }>();
    for (let day = new Date(range.from); day <= range.to; day = new Date(day.getTime() + 86_400_000)) {
      byDay.set(day.toISOString().slice(0, 10), { orders: 0, units: 0, revenue: 0n, cost: 0n });
    }

    for (const order of orders) {
      const key = order.deliveredAt!.toISOString().slice(0, 10);
      const entry = byDay.get(key);
      if (!entry) continue;
      entry.orders += 1;
      entry.units += order.itemCount;
      entry.revenue += order.total;
      entry.cost += order.cogsTotal;
    }

    const rows = [...byDay.entries()].map(([date, entry]) => ({
      date,
      orders: entry.orders,
      units: entry.units,
      revenue: Number(entry.revenue) / 100,
      margin: Number(entry.revenue - entry.cost) / 100,
      averageOrder: entry.orders === 0 ? 0 : Number(entry.revenue / BigInt(entry.orders)) / 100,
    }));

    return {
      columns: [
        { key: 'date', label: 'Jour', type: 'date' as const },
        { key: 'orders', label: 'Commandes', type: 'number' as const },
        { key: 'units', label: 'Unités', type: 'number' as const },
        { key: 'revenue', label: 'CA', type: MONEY },
        { key: 'margin', label: 'Marge', type: MONEY },
        { key: 'averageOrder', label: 'Panier moyen', type: MONEY },
      ],
      rows,
      series: rows.map((row) => ({ label: row.date, value: row.revenue })),
    };
  }

  private async salesByOrderField(range: Range, field: 'wilaya' | 'source' | 'agent') {
    const orders = await this.prisma.order.findMany({
      where: deliveredIn(range),
      select: {
        total: true,
        cogsTotal: true,
        wilayaCode: true,
        wilayaName: true,
        source: true,
        agentId: true,
      },
    });

    const agents = new Map<string, string>();
    if (field === 'agent') {
      const ids = [...new Set(orders.map((order) => order.agentId).filter(Boolean))] as string[];
      for (const user of await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })) {
        agents.set(user.id, user.name);
      }
    }

    const groups = new Map<string, { label: string; orders: number; revenue: bigint; cost: bigint }>();

    for (const order of orders) {
      const [key, name] =
        field === 'wilaya'
          ? [String(order.wilayaCode), order.wilayaName]
          : field === 'source'
            ? [order.source, order.source]
            : [order.agentId ?? 'none', agents.get(order.agentId ?? '') ?? 'Sans agent'];

      const entry = groups.get(key) ?? { label: name, orders: 0, revenue: 0n, cost: 0n };
      entry.orders += 1;
      entry.revenue += order.total;
      entry.cost += order.cogsTotal;
      groups.set(key, entry);
    }

    const rows = [...groups.values()]
      .sort((a, b) => Number(b.revenue - a.revenue))
      .slice(0, range.limit)
      .map((entry) => ({
        label: entry.label,
        orders: entry.orders,
        revenue: Number(entry.revenue) / 100,
        margin: Number(entry.revenue - entry.cost) / 100,
        averageOrder: Number(entry.revenue / BigInt(entry.orders)) / 100,
      }));

    return {
      columns: [
        { key: 'label', label: field === 'wilaya' ? 'Wilaya' : field === 'source' ? 'Canal' : 'Agent', type: 'text' as const },
        { key: 'orders', label: 'Commandes', type: 'number' as const },
        { key: 'revenue', label: 'CA', type: MONEY },
        { key: 'margin', label: 'Marge', type: MONEY },
        { key: 'averageOrder', label: 'Panier moyen', type: MONEY },
      ],
      rows,
      series: rows.slice(0, 12).map((row) => ({ label: row.label, value: row.revenue })),
    };
  }

  private async salesByCourier(range: Range) {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        createdAt: { gte: range.from, lt: new Date(range.to.getTime() + 86_400_000) },
      },
      select: {
        status: true,
        cost: true,
        courierId: true,
        courier: { select: { name: true } },
        order: { select: { total: true } },
      },
    });

    const groups = new Map<
      string,
      { label: string; shipped: number; delivered: number; revenue: bigint; cost: bigint }
    >();

    for (const shipment of shipments) {
      const key = shipment.courierId ?? 'fleet';
      const entry = groups.get(key) ?? {
        label: shipment.courier?.name ?? 'Flotte interne',
        shipped: 0,
        delivered: 0,
        revenue: 0n,
        cost: 0n,
      };
      entry.shipped += 1;
      entry.cost += shipment.cost;
      if (shipment.status === ShipmentStatus.DELIVERED) {
        entry.delivered += 1;
        entry.revenue += shipment.order.total;
      }
      groups.set(key, entry);
    }

    const rows = [...groups.values()]
      .sort((a, b) => b.shipped - a.shipped)
      .slice(0, range.limit)
      .map((entry) => ({
        label: entry.label,
        shipped: entry.shipped,
        delivered: entry.delivered,
        successRate: entry.shipped === 0 ? 0 : Math.round((entry.delivered / entry.shipped) * 1000) / 10,
        revenue: Number(entry.revenue) / 100,
        cost: Number(entry.cost) / 100,
      }));

    return {
      columns: [
        { key: 'label', label: 'Transporteur', type: 'text' as const },
        { key: 'shipped', label: 'Expédiés', type: 'number' as const },
        { key: 'delivered', label: 'Livrés', type: 'number' as const },
        { key: 'successRate', label: 'Réussite', type: 'percent' as const },
        { key: 'revenue', label: 'CA livré', type: MONEY },
        { key: 'cost', label: 'Coût transport', type: MONEY },
      ],
      rows,
    };
  }

  // --- inventory ------------------------------------------------------------

  private async inventoryValuation() {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: { onHand: { not: 0 } },
      select: {
        onHand: true,
        variant: {
          select: {
            sku: true,
            costPrice: true,
            price: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    const rows = levels
      .map((level) => {
        const cost = level.variant.costPrice * BigInt(level.onHand);
        const retail = level.variant.price * BigInt(level.onHand);
        return {
          label: `${level.variant.sku} — ${label(level.variant.product.name)}`,
          onHand: level.onHand,
          unitCost: Number(level.variant.costPrice) / 100,
          value: Number(cost) / 100,
          retailValue: Number(retail) / 100,
        };
      })
      .sort((a, b) => b.value - a.value);

    return {
      columns: [
        { key: 'label', label: 'Variante', type: 'text' as const },
        { key: 'onHand', label: 'En stock', type: 'number' as const },
        { key: 'unitCost', label: 'Coût unitaire', type: MONEY },
        { key: 'value', label: 'Valeur au coût', type: MONEY },
        { key: 'retailValue', label: 'Valeur au prix', type: MONEY },
      ],
      rows,
    };
  }

  /**
   * How long stock has been sitting, by the date of its last movement.
   *
   * Ageing stock is cash on a shelf. The buckets are the ones a buyer actually acts on:
   * under a month is fresh, over six months is a discount decision.
   */
  private async inventoryAgeing(range: Range) {
    const levels = await this.prisma.inventoryLevel.findMany({
      where: { onHand: { gt: 0 } },
      select: {
        variantId: true,
        onHand: true,
        variant: { select: { sku: true, costPrice: true, product: { select: { name: true } } } },
      },
    });

    const lastMovements = await this.prisma.stockMovement.groupBy({
      by: ['variantId'],
      where: { quantity: { lt: 0 } },
      _max: { createdAt: true },
    });
    const lastSold = new Map(lastMovements.map((row) => [row.variantId, row._max.createdAt]));

    const now = range.to;
    const rows = levels
      .map((level) => {
        const last = lastSold.get(level.variantId);
        const days = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;

        return {
          label: `${level.variant.sku} — ${label(level.variant.product.name)}`,
          onHand: level.onHand,
          value: Number(level.variant.costPrice * BigInt(level.onHand)) / 100,
          daysSinceSale: days,
          bucket:
            days === null ? 'jamais vendu' : days < 30 ? '< 30 j' : days < 90 ? '30-90 j' : days < 180 ? '90-180 j' : '> 180 j',
        };
      })
      .sort((a, b) => (b.daysSinceSale ?? 9999) - (a.daysSinceSale ?? 9999))
      .slice(0, range.limit);

    return {
      columns: [
        { key: 'label', label: 'Variante', type: 'text' as const },
        { key: 'onHand', label: 'En stock', type: 'number' as const },
        { key: 'value', label: 'Valeur', type: MONEY },
        { key: 'daysSinceSale', label: 'Jours sans vente', type: 'number' as const },
        { key: 'bucket', label: 'Tranche', type: 'text' as const },
      ],
      rows,
    };
  }

  /**
   * Demand that arrived while there was nothing to sell.
   *
   * Back-in-stock requests are the only honest signal a shop has for this: they are
   * customers who wanted the thing badly enough to leave a number.
   */
  private async stockouts(range: Range) {
    const requests = await this.prisma.stockNotification.groupBy({
      by: ['variantId'],
      where: {
        variantId: { not: null },
        createdAt: { gte: range.from, lt: new Date(range.to.getTime() + 86_400_000) },
      },
      _count: { _all: true },
    });

    const variantIds = requests.map((row) => row.variantId).filter(Boolean) as string[];
    const variants = await this.prisma.variant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, sku: true, price: true, product: { select: { name: true } } },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));

    const rows = requests
      .map((row) => {
        const variant = byId.get(row.variantId!);
        return {
          label: variant ? `${variant.sku} — ${label(variant.product.name)}` : (row.variantId ?? ''),
          requests: row._count._all,
          // What that demand was worth at list price, had there been stock.
          lostRevenue: variant ? (Number(variant.price) / 100) * row._count._all : 0,
        };
      })
      .sort((a, b) => b.requests - a.requests)
      .slice(0, range.limit);

    return {
      columns: [
        { key: 'label', label: 'Variante', type: 'text' as const },
        { key: 'requests', label: 'Demandes', type: 'number' as const },
        { key: 'lostRevenue', label: 'CA potentiel', type: MONEY },
      ],
      rows,
      series: rows.slice(0, 12).map((row) => ({ label: row.label, value: row.requests })),
    };
  }

  // --- customers ------------------------------------------------------------

  /** Customers grouped by the month they first ordered, and what they were worth. */
  private async cohorts(range: Range) {
    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null, firstOrderAt: { not: null } },
      select: { firstOrderAt: true, deliveredCount: true, lifetimeValue: true },
    });

    const groups = new Map<string, { customers: number; orders: number; value: bigint }>();

    for (const customer of customers) {
      const key = customer.firstOrderAt!.toISOString().slice(0, 7);
      const entry = groups.get(key) ?? { customers: 0, orders: 0, value: 0n };
      entry.customers += 1;
      entry.orders += customer.deliveredCount;
      entry.value += customer.lifetimeValue;
      groups.set(key, entry);
    }

    const rows = [...groups.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, range.limit)
      .map(([month, entry]) => ({
        month,
        customers: entry.customers,
        orders: entry.orders,
        ordersPerCustomer: Math.round((entry.orders / entry.customers) * 100) / 100,
        value: Number(entry.value) / 100,
        valuePerCustomer: Number(entry.value / BigInt(entry.customers)) / 100,
      }));

    return {
      columns: [
        { key: 'month', label: 'Cohorte', type: 'text' as const },
        { key: 'customers', label: 'Clients', type: 'number' as const },
        { key: 'orders', label: 'Commandes livrées', type: 'number' as const },
        { key: 'ordersPerCustomer', label: 'Commandes / client', type: 'number' as const },
        { key: 'value', label: 'Valeur totale', type: MONEY },
        { key: 'valuePerCustomer', label: 'Valeur / client', type: MONEY },
      ],
      rows,
      series: rows.map((row) => ({ label: row.month, value: row.valuePerCustomer })),
    };
  }

  /** How many customers came back, by how many orders they have placed. */
  private async retention(range: Range) {
    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null, deliveredCount: { gt: 0 } },
      select: { deliveredCount: true, lifetimeValue: true },
    });

    const buckets = [
      { key: '1', label: '1 commande', min: 1, max: 1 },
      { key: '2', label: '2 commandes', min: 2, max: 2 },
      { key: '3-5', label: '3 à 5', min: 3, max: 5 },
      { key: '6+', label: '6 et plus', min: 6, max: Number.POSITIVE_INFINITY },
    ];

    const total = customers.length;

    const rows = buckets.map((bucket) => {
      const inBucket = customers.filter(
        (customer) => customer.deliveredCount >= bucket.min && customer.deliveredCount <= bucket.max,
      );
      const value = inBucket.reduce((sum, customer) => sum + customer.lifetimeValue, 0n);

      return {
        label: bucket.label,
        customers: inBucket.length,
        share: total === 0 ? 0 : Math.round((inBucket.length / total) * 1000) / 10,
        value: Number(value) / 100,
      };
    });

    void range;

    return {
      columns: [
        { key: 'label', label: 'Fréquence', type: 'text' as const },
        { key: 'customers', label: 'Clients', type: 'number' as const },
        { key: 'share', label: 'Part', type: 'percent' as const },
        { key: 'value', label: 'Valeur', type: MONEY },
      ],
      rows,
      series: rows.map((row) => ({ label: row.label, value: row.customers })),
    };
  }

  // --- marketing ------------------------------------------------------------

  private async promotionPerformance(range: Range) {
    const usages = await this.prisma.promoUsage.findMany({
      where: { createdAt: { gte: range.from, lt: new Date(range.to.getTime() + 86_400_000) } },
      select: {
        amount: true,
        promotionId: true,
        promotion: { select: { name: true, code: true } },
        order: { select: { status: true, total: true, cogsTotal: true } },
      },
    });

    const groups = new Map<
      string,
      { label: string; uses: number; delivered: number; granted: bigint; revenue: bigint; margin: bigint }
    >();

    for (const usage of usages) {
      const entry = groups.get(usage.promotionId) ?? {
        label: usage.promotion.code
          ? `${usage.promotion.name} (${usage.promotion.code})`
          : usage.promotion.name,
        uses: 0,
        delivered: 0,
        granted: 0n,
        revenue: 0n,
        margin: 0n,
      };

      entry.uses += 1;
      entry.granted += usage.amount;

      if (usage.order?.status === OrderStatus.DELIVERED) {
        entry.delivered += 1;
        entry.revenue += usage.order.total;
        entry.margin += usage.order.total - usage.order.cogsTotal;
      }

      groups.set(usage.promotionId, entry);
    }

    const rows = [...groups.values()]
      .sort((a, b) => Number(b.granted - a.granted))
      .slice(0, range.limit)
      .map((entry) => ({
        label: entry.label,
        uses: entry.uses,
        delivered: entry.delivered,
        granted: Number(entry.granted) / 100,
        revenue: Number(entry.revenue) / 100,
        // Margin after what the promotion gave away: whether it paid for itself.
        netMargin: Number(entry.margin - entry.granted) / 100,
      }));

    return {
      columns: [
        { key: 'label', label: 'Promotion', type: 'text' as const },
        { key: 'uses', label: 'Utilisations', type: 'number' as const },
        { key: 'delivered', label: 'Livrées', type: 'number' as const },
        { key: 'granted', label: 'Remise accordée', type: MONEY },
        { key: 'revenue', label: 'CA généré', type: MONEY },
        { key: 'netMargin', label: 'Marge nette', type: MONEY },
      ],
      rows,
    };
  }

  /** What shoppers looked for and did not find. */
  private async zeroResults(range: Range) {
    const queries = await this.prisma.analyticsEvent.groupBy({
      by: ['query'],
      where: {
        query: { not: null },
        resultCount: 0,
        occurredAt: { gte: range.from, lt: new Date(range.to.getTime() + 86_400_000) },
      },
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: range.limit,
    });

    return {
      columns: [
        { key: 'query', label: 'Recherche', type: 'text' as const },
        { key: 'searches', label: 'Fois', type: 'number' as const },
      ],
      rows: queries.map((row) => ({ query: row.query ?? '', searches: row._count._all })),
      series: queries
        .slice(0, 12)
        .map((row) => ({ label: row.query ?? '', value: row._count._all })),
    };
  }

  /**
   * The conversion funnel, from analytics events to delivered orders.
   *
   * The last step is deliberately delivery rather than checkout: a funnel that stops at
   * "order placed" tells a cash-on-delivery shop it is converting far better than it is.
   */
  private async funnel(range: Range) {
    const end = new Date(range.to.getTime() + 86_400_000);

    const [views, addToCarts, checkouts, orders, delivered] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: { name: 'product_view', occurredAt: { gte: range.from, lt: end } },
      }),
      this.prisma.analyticsEvent.count({
        where: { name: 'add_to_cart', occurredAt: { gte: range.from, lt: end } },
      }),
      this.prisma.analyticsEvent.count({
        where: { name: 'checkout_start', occurredAt: { gte: range.from, lt: end } },
      }),
      this.prisma.order.count({
        where: { deletedAt: null, createdAt: { gte: range.from, lt: end } },
      }),
      this.prisma.order.count({
        where: { deletedAt: null, status: OrderStatus.DELIVERED, deliveredAt: { gte: range.from, lt: end } },
      }),
    ]);

    const steps = [
      { label: 'Vues produit', count: views },
      { label: 'Ajouts au panier', count: addToCarts },
      { label: 'Checkout entamé', count: checkouts },
      { label: 'Commandes passées', count: orders },
      { label: 'Commandes livrées', count: delivered },
    ];

    const top = steps[0]!.count;

    return {
      columns: [
        { key: 'label', label: 'Étape', type: 'text' as const },
        { key: 'count', label: 'Nombre', type: 'number' as const },
        { key: 'ofTop', label: 'Du sommet', type: 'percent' as const },
        { key: 'ofPrevious', label: 'De l’étape précédente', type: 'percent' as const },
      ],
      rows: steps.map((step, index) => {
        const previous = index === 0 ? step.count : steps[index - 1]!.count;
        return {
          label: step.label,
          count: step.count,
          ofTop: top === 0 ? 0 : Math.round((step.count / top) * 1000) / 10,
          ofPrevious: previous === 0 ? 0 : Math.round((step.count / previous) * 1000) / 10,
        };
      }),
      series: steps.map((step) => ({ label: step.label, value: step.count })),
    };
  }
}

interface Range {
  from: Date;
  to: Date;
  limit: number;
}

/** Delivered orders inside the period, by the day they were delivered. */
function deliveredIn(range: Range) {
  return {
    deletedAt: null,
    status: OrderStatus.DELIVERED,
    deliveredAt: { gte: range.from, lt: new Date(range.to.getTime() + 86_400_000) },
  };
}

function label(value: unknown): string {
  return t(value as Translated, 'fr');
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
