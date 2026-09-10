import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerSegment, OrderStatus, type Prisma } from '@jecks/db';
import {
  CUSTOMER_ERRORS,
  type AdminListQuery,
  type BlacklistInput,
  type CustomerCreateInput,
  type CustomerDetail,
  type CustomerGroupDto,
  type CustomerGroupInput,
  type CustomerMergeInput,
  type CustomerNoteInput,
  type CustomerPatchInput,
  type CustomerRow,
  type MergePreview,
  type SegmentSummary,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  averageDaysBetweenOrders,
  averageOrderValue,
  deliveryReliability,
  isOverdue,
  segmentOf,
} from './domain/segments.js';

/**
 * Customers — PRD F-AD-40 to F-AD-42.
 *
 * The phone number is the identity, so this module's most important operation is the
 * one that admits the identity was wrong: merging two records of the same person.
 *
 * Rollups (`ordersCount`, `lifetimeValue`) are cached on the row and refreshed when an
 * order changes state, because the customer list is read constantly and aggregating on
 * every read would make it the slowest screen in the admin.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  // --- list -----------------------------------------------------------------

  async list(query: AdminListQuery, filters: Record<string, string[]>) {
    const where = this.whereFrom(query, filters);

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { [query.sort ?? 'createdAt']: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { group: { select: { name: true } } },
      }),
      this.prisma.customer.count({ where }),
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
    const rows = await this.prisma.customer.findMany({
      where: this.whereFrom(query, filters),
      orderBy: { lifetimeValue: 'desc' },
      take: 50_000,
      include: { group: { select: { name: true } } },
    });
    return rows.map((row) => this.toRow(row));
  }

  async segments(): Promise<SegmentSummary[]> {
    const grouped = await this.prisma.customer.groupBy({
      by: ['segment'],
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { lifetimeValue: true, deliveredCount: true },
    });

    const order: CustomerSegment[] = [
      CustomerSegment.VIP,
      CustomerSegment.RETURNING,
      CustomerSegment.NEW,
      CustomerSegment.AT_RISK,
      CustomerSegment.BLACKLISTED,
    ];

    const bySegment = new Map(grouped.map((row) => [row.segment, row]));

    return order.map((segment) => {
      const row = bySegment.get(segment);
      const value = row?._sum.lifetimeValue ?? 0n;
      const delivered = row?._sum.deliveredCount ?? 0;

      return {
        segment,
        count: row?._count._all ?? 0,
        lifetimeValueMinor: value.toString(),
        averageOrderMinor: (delivered > 0 ? value / BigInt(delivered) : 0n).toString(),
      };
    });
  }

  // --- one customer ---------------------------------------------------------

  async get(id: string): Promise<CustomerDetail> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        group: { select: { name: true } },
        addresses: {
          orderBy: { isDefault: 'desc' },
          include: {
            commune: { select: { nameAscii: true } },
            wilaya: { select: { nameAscii: true } },
          },
        },
        orders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            itemCount: true,
            createdAt: true,
          },
        },
        notes: { orderBy: { createdAt: 'desc' }, take: 50 },
        loyaltyTransactions: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });

    if (!customer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Customer not found' });

    const rhythm = averageDaysBetweenOrders(customer.orders.map((order) => order.createdAt));

    // `CustomerNote` keeps an author id without a relation, so the names come separately
    // rather than through an include that does not exist.
    const authorIds = [...new Set(customer.notes.map((note) => note.authorId).filter(Boolean))];
    const authors = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: authorIds as string[] } },
          select: { id: true, name: true },
        })
      ).map((user) => [user.id, user.name]),
    );

    return {
      ...this.toRow(customer),
      altPhone: customer.altPhone,
      locale: customer.locale,
      blacklistReason: customer.blacklistReason,
      groupId: customer.groupId,
      firstOrderAt: customer.firstOrderAt?.toISOString() ?? null,
      cancelledCount: customer.cancelledCount,
      averageDaysBetweenOrders: rhythm,
      overdue: isOverdue(customer.lastOrderAt, rhythm),
      addresses: customer.addresses.map((address) => ({
        id: address.id,
        label: address.label,
        address: address.address ?? '',
        communeName: address.commune?.nameAscii ?? null,
        wilayaName: address.wilaya.nameAscii,
        isDefault: address.isDefault,
      })),
      orders: customer.orders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        totalMinor: order.total.toString(),
        itemCount: order.itemCount,
        createdAt: order.createdAt.toISOString(),
      })),
      notes: customer.notes.map((note) => ({
        id: note.id,
        body: note.body,
        authorName: note.authorId ? (authors.get(note.authorId) ?? null) : null,
        createdAt: note.createdAt.toISOString(),
      })),
      loyalty: customer.loyaltyTransactions.map((entry) => ({
        id: entry.id,
        points: entry.points,
        kind: entry.kind,
        balanceAfter: entry.balanceAfter,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
      consents: {
        acceptsMarketing: customer.acceptsMarketing,
        updatedAt: customer.updatedAt.toISOString(),
      },
    };
  }

  async create(input: CustomerCreateInput): Promise<CustomerDetail> {
    const existing = await this.prisma.customer.findUnique({ where: { phone: input.phone } });
    if (existing) {
      throw new BadRequestException({
        code: CUSTOMER_ERRORS.PHONE_TAKEN,
        message: 'Ce numéro appartient déjà à un client',
        details: { field: 'phone', customerId: existing.id },
      });
    }

    const customer = await this.prisma.customer.create({
      data: {
        phone: input.phone,
        fullName: input.fullName,
        email: input.email ?? null,
        groupId: input.groupId ?? null,
        acceptsMarketing: input.acceptsMarketing,
      },
    });

    return this.get(customer.id);
  }

  async update(id: string, input: CustomerPatchInput): Promise<CustomerDetail> {
    await this.require(id);

    await this.prisma.customer.update({
      where: { id },
      data: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.altPhone === undefined ? {} : { altPhone: input.altPhone }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
        ...(input.acceptsMarketing === undefined
          ? {}
          : { acceptsMarketing: input.acceptsMarketing }),
      },
    });

    return this.get(id);
  }

  async addNote(id: string, input: CustomerNoteInput, userId: string | null): Promise<CustomerDetail> {
    await this.require(id);

    await this.prisma.customerNote.create({
      data: { customerId: id, body: input.body, authorId: userId },
    });

    return this.get(id);
  }

  /**
   * Blocks or unblocks a customer.
   *
   * Blacklisting is the only signal that refuses an order outright, so it takes a
   * reason: the next agent to see the order needs to know whether this was three
   * refused parcels or an argument on the phone.
   */
  async setBlacklisted(id: string, input: BlacklistInput): Promise<CustomerDetail> {
    const customer = await this.require(id);

    await this.prisma.customer.update({
      where: { id },
      data: {
        blacklisted: input.blacklisted,
        blacklistReason: input.blacklisted ? (input.reason ?? null) : null,
        segment: input.blacklisted
          ? CustomerSegment.BLACKLISTED
          : segmentOf({
              blacklisted: false,
              deliveredCount: customer.deliveredCount,
              lifetimeValueMinor: customer.lifetimeValue,
              lastOrderAt: customer.lastOrderAt,
            }),
      },
    });

    return this.get(id);
  }

  // --- merging --------------------------------------------------------------

  /** What a merge would move, so it can be agreed to rather than discovered. */
  async previewMerge(keepId: string, mergeId: string): Promise<MergePreview> {
    const [keep, merge] = await Promise.all([this.require(keepId), this.require(mergeId)]);

    const [orders, addresses, notes, reviews] = await Promise.all([
      this.prisma.order.count({ where: { customerId: mergeId } }),
      this.prisma.customerAddress.count({ where: { customerId: mergeId } }),
      this.prisma.customerNote.count({ where: { customerId: mergeId } }),
      this.prisma.review.count({ where: { customerId: mergeId } }),
    ]);

    return {
      keep: {
        id: keep.id,
        phone: keep.phone,
        fullName: keep.fullName,
        ordersCount: keep.ordersCount,
      },
      merge: {
        id: merge.id,
        phone: merge.phone,
        fullName: merge.fullName,
        ordersCount: merge.ordersCount,
      },
      moves: { orders, addresses, notes, reviews, loyaltyPoints: merge.loyaltyPoints },
    };
  }

  /**
   * Merges one customer into another — PRD F-AD-42.
   *
   * Everything moves; the merged record is soft-deleted rather than removed, because an
   * order that referenced it is still readable and somebody will ask what happened.
   * A blacklisted record refuses to merge: folding it into a clean one would launder
   * exactly the history the blacklist exists to keep.
   */
  async merge(input: CustomerMergeInput): Promise<CustomerDetail> {
    const [keep, merge] = await Promise.all([
      this.require(input.keepId),
      this.require(input.mergeId),
    ]);

    if (merge.blacklisted && !keep.blacklisted) {
      throw new BadRequestException({
        code: CUSTOMER_ERRORS.MERGE_BLACKLISTED,
        message:
          'Le compte à fusionner est sur liste noire. Bloquez d’abord celui qui reste, ou levez le blocage.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { customerId: merge.id }, data: { customerId: keep.id } });
      await tx.customerAddress.updateMany({
        where: { customerId: merge.id },
        data: { customerId: keep.id },
      });
      await tx.customerNote.updateMany({
        where: { customerId: merge.id },
        data: { customerId: keep.id },
      });
      await tx.review.updateMany({ where: { customerId: merge.id }, data: { customerId: keep.id } });
      await tx.loyaltyTransaction.updateMany({
        where: { customerId: merge.id },
        data: { customerId: keep.id },
      });
      await tx.wishlistItem.updateMany({
        where: { customerId: merge.id },
        data: { customerId: keep.id },
      });
      await tx.promoUsage.updateMany({
        where: { customerId: merge.id },
        data: { customerId: keep.id },
      });

      await tx.customer.update({
        where: { id: keep.id },
        data: {
          loyaltyPoints: keep.loyaltyPoints + merge.loyaltyPoints,
          // The second number is worth keeping: it is how this person was reached once.
          altPhone: keep.altPhone ?? merge.phone,
          email: keep.email ?? merge.email,
          acceptsMarketing: keep.acceptsMarketing || merge.acceptsMarketing,
        },
      });

      await tx.customer.update({
        where: { id: merge.id },
        data: {
          deletedAt: new Date(),
          // Freed so the surviving record could take it later if it ever needs to.
          phone: `merged:${merge.phone}`,
        },
      });
    });

    await this.refreshRollups(keep.id);
    return this.get(keep.id);
  }

  /**
   * Recomputes a customer's cached figures from their orders.
   *
   * Called after a merge and by the nightly job. Everything here is derived, so a
   * rollup that has drifted is repaired rather than reconciled.
   */
  async refreshRollups(customerId: string): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { customerId, deletedAt: null },
      select: { status: true, total: true, createdAt: true, deliveredAt: true },
    });

    const delivered = orders.filter((order) => order.status === OrderStatus.DELIVERED);
    const failed = orders.filter((order) => order.status === OrderStatus.FAILED);
    const cancelled = orders.filter(
      (order) => order.status === OrderStatus.CANCELLED || order.status === OrderStatus.RETURNED,
    );

    const dates = orders.map((order) => order.createdAt).sort((a, b) => a.getTime() - b.getTime());
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { blacklisted: true },
    });

    const lifetimeValue = delivered.reduce((sum, order) => sum + order.total, 0n);
    const lastOrderAt = dates.at(-1) ?? null;

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ordersCount: orders.length,
        deliveredCount: delivered.length,
        failedCount: failed.length,
        cancelledCount: cancelled.length,
        lifetimeValue,
        firstOrderAt: dates[0] ?? null,
        lastOrderAt,
        segment: segmentOf({
          blacklisted: customer?.blacklisted ?? false,
          deliveredCount: delivered.length,
          lifetimeValueMinor: lifetimeValue,
          lastOrderAt,
        }),
      },
    });
  }

  // --- groups ---------------------------------------------------------------

  async listGroups(): Promise<CustomerGroupDto[]> {
    const groups = await this.prisma.customerGroup.findMany({
      orderBy: { slug: 'asc' },
      include: { _count: { select: { customers: true } } },
    });

    return groups.map((group) => ({
      id: group.id,
      name: group.name as Translated,
      slug: group.slug,
      discountPercent: Number(group.discountPercent),
      customerCount: group._count.customers,
    }));
  }

  async createGroup(input: CustomerGroupInput): Promise<CustomerGroupDto> {
    const existing = await this.prisma.customerGroup.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new BadRequestException({
        code: 'SLUG_TAKEN',
        message: 'A group already uses that slug',
        details: { field: 'slug' },
      });
    }

    const group = await this.prisma.customerGroup.create({
      data: {
        name: input.name as Prisma.InputJsonValue,
        slug: input.slug,
        discountPercent: input.discountPercent,
      },
    });

    return {
      id: group.id,
      name: group.name as Translated,
      slug: group.slug,
      discountPercent: Number(group.discountPercent),
      customerCount: 0,
    };
  }

  async updateGroup(id: string, input: CustomerGroupInput): Promise<CustomerGroupDto> {
    const group = await this.prisma.customerGroup.update({
      where: { id },
      data: {
        name: input.name as Prisma.InputJsonValue,
        slug: input.slug,
        discountPercent: input.discountPercent,
      },
      include: { _count: { select: { customers: true } } },
    });

    return {
      id: group.id,
      name: group.name as Translated,
      slug: group.slug,
      discountPercent: Number(group.discountPercent),
      customerCount: group._count.customers,
    };
  }

  /** A group that prices anything cannot vanish under the customers in it. */
  async removeGroup(id: string): Promise<void> {
    const group = await this.prisma.customerGroup.findUnique({
      where: { id },
      include: { _count: { select: { customers: true } } },
    });
    if (!group) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Group not found' });

    if (group._count.customers > 0) {
      throw new BadRequestException({
        code: CUSTOMER_ERRORS.GROUP_IN_USE,
        message: `${group._count.customers} client(s) sont dans ce groupe.`,
      });
    }

    await this.prisma.customerGroup.delete({ where: { id } });
  }

  // --- helpers --------------------------------------------------------------

  private async require(id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Customer not found' });
    return customer;
  }

  private whereFrom(
    query: AdminListQuery,
    filters: Record<string, string[]>,
  ): Prisma.CustomerWhereInput {
    const search = query.q?.trim();

    return {
      deletedAt: null,
      ...(filters.segment?.length ? { segment: { in: filters.segment as CustomerSegment[] } } : {}),
      ...(filters.groupId?.length ? { groupId: { in: filters.groupId } } : {}),
      ...(filters.blacklisted?.length ? { blacklisted: filters.blacklisted[0] === 'true' } : {}),
      ...(filters.wilayaCode?.length
        ? { addresses: { some: { wilayaCode: { in: filters.wilayaCode.map(Number) } } } }
        : {}),
      ...(search
        ? {
            OR: [
              { phone: { contains: search } },
              { altPhone: { contains: search } },
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private toRow(customer: {
    id: string;
    phone: string;
    fullName: string;
    email: string | null;
    segment: CustomerSegment;
    ordersCount: number;
    deliveredCount: number;
    failedCount: number;
    lifetimeValue: bigint;
    loyaltyPoints: number;
    blacklisted: boolean;
    acceptsMarketing: boolean;
    lastOrderAt: Date | null;
    createdAt: Date;
    group?: { name: unknown } | null;
  }): CustomerRow {
    return {
      id: customer.id,
      phone: customer.phone,
      fullName: customer.fullName,
      email: customer.email,
      segment: customer.segment,
      groupName: (customer.group?.name as Translated | undefined) ?? null,
      ordersCount: customer.ordersCount,
      deliveredCount: customer.deliveredCount,
      failedCount: customer.failedCount,
      lifetimeValueMinor: customer.lifetimeValue.toString(),
      averageOrderMinor: averageOrderValue({
        deliveredCount: customer.deliveredCount,
        lifetimeValueMinor: customer.lifetimeValue,
      }).toString(),
      reliability: deliveryReliability({
        deliveredCount: customer.deliveredCount,
        failedCount: customer.failedCount,
      }),
      loyaltyPoints: customer.loyaltyPoints,
      blacklisted: customer.blacklisted,
      acceptsMarketing: customer.acceptsMarketing,
      lastOrderAt: customer.lastOrderAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
    };
  }
}

export const CUSTOMER_EXPORT_COLUMNS = [
  { header: 'Téléphone', value: (row: CustomerRow) => row.phone },
  { header: 'Nom', value: (row: CustomerRow) => row.fullName },
  { header: 'E-mail', value: (row: CustomerRow) => row.email ?? '' },
  { header: 'Segment', value: (row: CustomerRow) => row.segment },
  { header: 'Commandes', value: (row: CustomerRow) => row.ordersCount },
  { header: 'Livrées', value: (row: CustomerRow) => row.deliveredCount },
  { header: 'Fiabilité (%)', value: (row: CustomerRow) => row.reliability ?? '' },
  { header: 'Valeur vie (DA)', value: (row: CustomerRow) => Number(row.lifetimeValueMinor) / 100 },
  { header: 'Points', value: (row: CustomerRow) => row.loyaltyPoints },
  { header: 'Dernière commande', value: (row: CustomerRow) => row.lastOrderAt?.slice(0, 10) ?? '' },
];
