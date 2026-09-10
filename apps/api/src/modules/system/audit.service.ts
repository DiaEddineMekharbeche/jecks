import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import type {
  AdminListQuery,
  AdminListResponse,
  AuditListFilters,
  AuditRow,
} from '@jecks/shared';
import type { ExportColumn } from '../../common/list/export.service.js';
import { andWhere, listResponse, planExport, planList } from '../../common/list/list.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The audit log — PRD F-AD-93.
 *
 * Read-only by construction: there is no write path here, because the global
 * `AuditInterceptor` is the only thing that writes rows. A log an admin can edit is not
 * a log.
 */

const SORTABLE: Record<string, string> = {
  createdAt: 'createdAt',
  entityType: 'entityType',
  action: 'action',
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminListQuery,
    filters: AuditListFilters,
  ): Promise<AdminListResponse<AuditRow>> {
    const where = this.buildWhere(query, filters);
    const plan = planList(query, SORTABLE, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: plan.orderBy as Prisma.AuditLogOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
        include: { actor: { select: { name: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return listResponse(query, rows.map(toRow), total);
  }

  async listForExport(query: AdminListQuery, filters: AuditListFilters): Promise<AuditRow[]> {
    const where = this.buildWhere(query, filters);
    const total = await this.prisma.auditLog.count({ where });
    const { take } = planExport(total);

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { name: true } } },
    });
    return rows.map(toRow);
  }

  /** The distinct entity types present, so the filter offers what actually exists. */
  async entityTypes(): Promise<string[]> {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['entityType'],
      _count: { _all: true },
      orderBy: { entityType: 'asc' },
    });
    return rows.map((row) => row.entityType);
  }

  /** Everything that ever happened to one record, for the "history" tab of an editor. */
  async forEntity(entityType: string, entityId: string, limit = 50): Promise<AuditRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { actor: { select: { name: true } } },
    });
    return rows.map(toRow);
  }

  private buildWhere(
    query: AdminListQuery,
    filters: AuditListFilters,
  ): Prisma.AuditLogWhereInput {
    const term = query.q?.trim();
    return andWhere(
      filters.entityType?.length ? { entityType: { in: filters.entityType } } : undefined,
      filters.entityId?.length ? { entityId: { in: filters.entityId } } : undefined,
      filters.actorId?.length ? { actorId: { in: filters.actorId } } : undefined,
      filters.action?.length ? { action: { in: filters.action } } : undefined,
      term
        ? {
            OR: [
              { actorLabel: { contains: term, mode: 'insensitive' } },
              { entityId: { contains: term, mode: 'insensitive' } },
              { entityType: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
    ) as Prisma.AuditLogWhereInput;
  }
}

type AuditRecord = Prisma.AuditLogGetPayload<{ include: { actor: { select: { name: true } } } }>;

function toRow(row: AuditRecord): AuditRow {
  return {
    id: row.id,
    actorId: row.actorId,
    // The label was captured at write time; the join is a fallback for rows written
    // before a rename, which is exactly when the stored label is the useful one.
    actorLabel: row.actorLabel ?? row.actor?.name ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    changes: (row.changes ?? null) as AuditRow['changes'],
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

export const AUDIT_EXPORT_COLUMNS: ExportColumn<AuditRow>[] = [
  { header: 'Date', value: (row) => new Date(row.createdAt), width: 22 },
  { header: 'Auteur', value: (row) => row.actorLabel ?? 'Système', width: 24 },
  { header: 'Action', value: (row) => row.action, width: 12 },
  { header: 'Entité', value: (row) => row.entityType, width: 20 },
  { header: 'Identifiant', value: (row) => row.entityId ?? '', width: 38 },
  {
    header: 'Champs modifiés',
    value: (row) => (row.changes ? Object.keys(row.changes).join(', ') : ''),
    width: 40,
  },
  { header: 'IP', value: (row) => row.ip ?? '', width: 18 },
];
