import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import type { AdminListQuery, AdminListResponse } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  andWhere,
  listResponse,
  planExport,
  planList,
  searchFilter,
} from '../../common/list/list.helper.js';
import type { ExportColumn } from '../../common/list/export.service.js';

/**
 * Read side of the orders module — PRD F-AD-30.
 *
 * Writes (transitions, edits, returns) land in M3; this is the list the operator lives
 * in, and the screen that proves the list framework end to end.
 */

/** Sort keys the API accepts, mapped to Prisma paths. Anything else is rejected. */
export const ORDER_SORTABLE = {
  createdAt: 'createdAt',
  number: 'number',
  total: 'total',
  status: 'status',
  customer: 'customerName',
  wilaya: 'wilayaName',
  deliveredAt: 'deliveredAt',
} as const;

export interface OrderListFilters {
  status?: string[];
  paymentStatus?: string[];
  wilayaCode?: string[];
  source?: string[];
  paymentMethod?: string[];
  from?: string[];
  to?: string[];
}

export interface OrderRow {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  source: string;
  customerName: string;
  customerPhone: string;
  wilayaCode: number;
  wilayaName: string;
  communeName: string | null;
  deliveryType: string;
  itemCount: number;
  total: bigint;
  cogsTotal: bigint;
  shippingTotal: bigint;
  discountTotal: bigint;
  riskScore: number;
  agentName: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

@Injectable()
export class OrdersListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminListQuery,
    filters: OrderListFilters,
  ): Promise<AdminListResponse<OrderRow>> {
    const where = this.buildWhere(query, filters);
    const plan = planList(query, ORDER_SORTABLE, 'createdAt');

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, ...plan, select: this.select() }),
      this.prisma.order.count({ where }),
    ]);

    return listResponse(query, rows.map(toRow), total);
  }

  /** Same filters, no pagination — the export covers everything the list shows. */
  async listForExport(query: AdminListQuery, filters: OrderListFilters): Promise<OrderRow[]> {
    const where = this.buildWhere(query, filters);
    const total = await this.prisma.order.count({ where });
    const { take } = planExport(total);

    const rows = await this.prisma.order.findMany({
      where,
      take,
      orderBy: planList(query, ORDER_SORTABLE, 'createdAt').orderBy,
      select: this.select(),
    });

    return rows.map(toRow);
  }

  /** Tab counters above the list — PRD F-AD-30. One grouped query, not one per tab. */
  async statusCounts(filters: OrderListFilters): Promise<Record<string, number>> {
    // Deliberately ignores the status filter: a tab must show its own count even while
    // another tab is selected.
    const { status: _ignored, ...rest } = filters;
    const where = this.buildWhere({ page: 1, pageSize: 1, order: 'desc' }, rest);

    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const counts: Record<string, number> = { ALL: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }
    return counts;
  }

  private buildWhere(query: AdminListQuery, filters: OrderListFilters): Prisma.OrderWhereInput {
    const from = filters.from?.[0];
    const to = filters.to?.[0];

    return andWhere(
      { deletedAt: null },
      filters.status?.length ? { status: { in: filters.status as never } } : undefined,
      filters.paymentStatus?.length
        ? { paymentStatus: { in: filters.paymentStatus as never } }
        : undefined,
      filters.paymentMethod?.length
        ? { paymentMethod: { in: filters.paymentMethod as never } }
        : undefined,
      filters.source?.length ? { source: { in: filters.source as never } } : undefined,
      filters.wilayaCode?.length
        ? { wilayaCode: { in: filters.wilayaCode.map(Number).filter(Number.isFinite) } }
        : undefined,
      from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              // A date-only `to` must include that whole day, not stop at midnight.
              ...(to ? { lte: endOfDay(to) } : {}),
            },
          }
        : undefined,
      searchFilter(query.q, ['number', 'customerName', 'customerPhone', 'wilayaName']),
    ) as Prisma.OrderWhereInput;
  }

  private select() {
    return {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      source: true,
      customerName: true,
      customerPhone: true,
      wilayaCode: true,
      wilayaName: true,
      communeName: true,
      deliveryType: true,
      itemCount: true,
      total: true,
      cogsTotal: true,
      shippingTotal: true,
      discountTotal: true,
      riskScore: true,
      createdAt: true,
      deliveredAt: true,
      agent: { select: { name: true } },
    } satisfies Prisma.OrderSelect;
  }
}

type SelectedOrder = OrderRow & { agent: { name: string } | null };

function toRow(row: Omit<SelectedOrder, 'agentName'>): OrderRow {
  const { agent, ...rest } = row as SelectedOrder;
  return { ...rest, agentName: agent?.name ?? null };
}

function endOfDay(value: string): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

/** Columns for the CSV and XLSX export. Money is converted to dinars for the sheet. */
export const ORDER_EXPORT_COLUMNS: ExportColumn<OrderRow>[] = [
  { header: 'Numéro', value: (row) => row.number, width: 18 },
  { header: 'Date', value: (row) => row.createdAt },
  { header: 'Statut', value: (row) => row.status },
  { header: 'Paiement', value: (row) => row.paymentStatus },
  { header: 'Client', value: (row) => row.customerName, width: 24 },
  { header: 'Téléphone', value: (row) => row.customerPhone, width: 16 },
  { header: 'Wilaya', value: (row) => row.wilayaName },
  { header: 'Commune', value: (row) => row.communeName },
  { header: 'Livraison', value: (row) => row.deliveryType },
  { header: 'Articles', value: (row) => row.itemCount },
  { header: 'Remise (DA)', value: (row) => toDinars(row.discountTotal) },
  { header: 'Livraison (DA)', value: (row) => toDinars(row.shippingTotal) },
  { header: 'Total (DA)', value: (row) => toDinars(row.total) },
  { header: 'Coût marchandise (DA)', value: (row) => toDinars(row.cogsTotal) },
  { header: 'Source', value: (row) => row.source },
  { header: 'Agent', value: (row) => row.agentName },
  { header: 'Livrée le', value: (row) => row.deliveredAt },
];

/** Spreadsheets want a number they can sum, not a formatted string. */
function toDinars(minor: bigint): number {
  return Number(minor) / 100;
}
