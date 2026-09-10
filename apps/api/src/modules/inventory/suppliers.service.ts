import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  INVENTORY_ERRORS,
  type AdminListQuery,
  type AdminListResponse,
  type SupplierInput,
  type SupplierRow,
} from '@jecks/shared';
import type { ExportColumn } from '../../common/list/export.service.js';
import { andWhere, listResponse, planExport, planList, searchFilter } from '../../common/list/list.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Suppliers — PRD F-AD-52. */

const SORTABLE: Record<string, string> = {
  name: 'name',
  createdAt: 'createdAt',
};

const INCLUDE = {
  purchaseOrders: {
    where: { status: { not: 'CANCELLED' as const } },
    select: { total: true, createdAt: true },
  },
} satisfies Prisma.SupplierInclude;

type SupplierRecord = Prisma.SupplierGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminListQuery,
    filters: { active?: string[] },
  ): Promise<AdminListResponse<SupplierRow>> {
    const where = this.buildWhere(query, filters);
    const plan = planList(query, SORTABLE, 'name');

    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include: INCLUDE,
        orderBy: plan.orderBy as Prisma.SupplierOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return listResponse(query, rows.map(toRow), total);
  }

  async listForExport(
    query: AdminListQuery,
    filters: { active?: string[] },
  ): Promise<SupplierRow[]> {
    const where = this.buildWhere(query, filters);
    const total = await this.prisma.supplier.count({ where });
    const { take } = planExport(total);
    const rows = await this.prisma.supplier.findMany({
      where,
      include: INCLUDE,
      orderBy: { name: 'asc' },
      take,
    });
    return rows.map(toRow);
  }

  /** Unpaginated, for the purchase-order editor's supplier picker. */
  async options(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.supplier.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  async get(id: string): Promise<SupplierRow> {
    const row = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' });
    return toRow(row);
  }

  async create(input: SupplierInput): Promise<SupplierRow> {
    const created = await this.prisma.supplier.create({
      data: this.toData(input),
      select: { id: true },
    });
    return this.get(created.id);
  }

  async update(id: string, input: SupplierInput): Promise<SupplierRow> {
    await this.prisma.supplier.update({ where: { id }, data: this.toData(input) });
    return this.get(id);
  }

  /**
   * Soft delete. A supplier with purchase orders keeps the rows that reference it, so
   * archiving is the only safe removal; the list hides archived rows either way.
   */
  async remove(id: string): Promise<void> {
    const open = await this.prisma.purchaseOrder.count({
      where: { supplierId: id, status: { in: ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'] } },
    });
    if (open > 0) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.SUPPLIER_IN_USE,
        message: `${open} purchase order(s) are still open with this supplier`,
        details: { openPurchaseOrders: open },
      });
    }
    await this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }

  private toData(input: SupplierInput): Prisma.SupplierUncheckedCreateInput {
    return {
      name: input.name,
      contactName: input.contactName || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      note: input.note || null,
      active: input.active,
    };
  }

  private buildWhere(
    query: AdminListQuery,
    filters: { active?: string[] },
  ): Prisma.SupplierWhereInput {
    return andWhere(
      { deletedAt: null },
      filters.active?.length ? { active: filters.active.includes('true') } : undefined,
      searchFilter(query.q, ['name', 'contactName', 'phone', 'email']),
    ) as Prisma.SupplierWhereInput;
  }
}

function toRow(row: SupplierRecord): SupplierRow {
  const purchased = row.purchaseOrders.reduce((sum, order) => sum + order.total, 0n);
  const last = row.purchaseOrders.reduce<Date | null>(
    (latest, order) => (!latest || order.createdAt > latest ? order.createdAt : latest),
    null,
  );

  return {
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    note: row.note,
    active: row.active,
    purchaseOrderCount: row.purchaseOrders.length,
    purchasedMinor: purchased.toString(),
    lastOrderAt: last?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const SUPPLIER_EXPORT_COLUMNS: ExportColumn<SupplierRow>[] = [
  { header: 'Fournisseur', value: (row) => row.name, width: 32 },
  { header: 'Contact', value: (row) => row.contactName ?? '', width: 24 },
  { header: 'Téléphone', value: (row) => row.phone ?? '', width: 16 },
  { header: 'E-mail', value: (row) => row.email ?? '', width: 28 },
  { header: 'Adresse', value: (row) => row.address ?? '', width: 40 },
  { header: 'Commandes', value: (row) => row.purchaseOrderCount },
  { header: 'Total acheté (DA)', value: (row) => Number(row.purchasedMinor) / 100 },
  { header: 'Actif', value: (row) => (row.active ? 'oui' : 'non') },
];
