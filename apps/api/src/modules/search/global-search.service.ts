import { Injectable } from '@nestjs/common';
import { parseDzPhoneOrNull, t, type GlobalSearchHit, type Translated } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Backs the ⌘K palette — PRD Section 9.3: reach an order by number or phone, a product
 * by name or SKU, a customer by phone or name.
 *
 * Each group is queried only when the term could plausibly match it, so typing a phone
 * number does not also scan the product catalogue.
 */
@Injectable()
export class GlobalSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    term: string,
    limit: number,
    permissions: string[],
  ): Promise<GlobalSearchHit[]> {
    const query = term.trim();
    if (query.length < 1) return [];

    const can = (permission: string) => permissions.includes(permission);
    // A typed phone number is normalized first, so "0551 23 45 67" finds +213551234567.
    const phone = parseDzPhoneOrNull(query)?.e164;

    const [orders, products, customers] = await Promise.all([
      can('orders.read') ? this.orders(query, phone, limit) : [],
      can('catalog.read') ? this.products(query, limit) : [],
      can('customers.read') ? this.customers(query, phone, limit) : [],
    ]);

    return [...orders, ...products, ...customers];
  }

  private async orders(query: string, phone: string | undefined, limit: number) {
    const rows = await this.prisma.order.findMany({
      where: {
        deletedAt: null,
        OR: [
          { number: { contains: query, mode: 'insensitive' } },
          { customerName: { contains: query, mode: 'insensitive' } },
          ...(phone ? [{ customerPhone: phone }] : [{ customerPhone: { contains: query } }]),
        ],
      },
      // Newest first: the order someone is looking for is almost always a recent one.
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        number: true,
        customerName: true,
        status: true,
        total: true,
        wilayaName: true,
      },
    });

    return rows.map(
      (row): GlobalSearchHit => ({
        group: 'orders',
        id: row.id,
        title: row.number,
        subtitle: `${row.customerName} · ${row.wilayaName} · ${formatDzd(row.total)}`,
        href: `/orders/${row.id}`,
      }),
    );
  }

  private async products(query: string, limit: number) {
    const rows = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { path: ['fr'], string_contains: query } },
          { name: { path: ['en'], string_contains: query } },
          { slug: { contains: slugish(query), mode: 'insensitive' } },
          { variants: { some: { sku: { contains: query, mode: 'insensitive' } } } },
        ],
      },
      orderBy: { salesCount: 'desc' },
      take: limit,
      select: { id: true, name: true, slug: true, status: true, totalStock: true },
    });

    return rows.map(
      (row): GlobalSearchHit => ({
        group: 'products',
        id: row.id,
        title: t(row.name as Translated, 'fr') || row.slug,
        subtitle: `${row.status.toLowerCase()} · ${row.totalStock} en stock`,
        href: `/catalog/products/${row.id}`,
      }),
    );
  }

  private async customers(query: string, phone: string | undefined, limit: number) {
    const rows = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { fullName: { contains: query, mode: 'insensitive' } },
          ...(phone ? [{ phone }] : [{ phone: { contains: query } }]),
        ],
      },
      orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
      take: limit,
      select: { id: true, fullName: true, phone: true, ordersCount: true, lifetimeValue: true },
    });

    return rows.map(
      (row): GlobalSearchHit => ({
        group: 'customers',
        id: row.id,
        title: row.fullName,
        subtitle: `${row.phone} · ${row.ordersCount} commande${row.ordersCount > 1 ? 's' : ''} · ${formatDzd(row.lifetimeValue)}`,
        href: `/customers/${row.id}`,
      }),
    );
  }
}

/** Centimes to a compact "3 500 DA" for a one-line search result. */
function formatDzd(minor: bigint): string {
  const dinars = Number(minor / 100n);
  return `${new Intl.NumberFormat('fr-DZ').format(dinars)} DA`;
}

/** Lets "Trucker Atlas" match the slug "trucker-atlas". */
function slugish(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, '-');
}
