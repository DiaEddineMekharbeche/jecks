import { BadRequestException } from '@nestjs/common';
import {
  EXPORT_MAX_ROWS,
  type AdminListMeta,
  type AdminListQuery,
  type AdminListResponse,
} from '@jecks/shared';

/**
 * The shared half of every admin list endpoint — PRD-COMPLETION Section 2.3.
 *
 * Modules supply a sort whitelist and a Prisma `where`; this decides skip/take, builds
 * `orderBy`, and shapes the envelope. Keeping it here is what stops twelve modules from
 * each inventing their own pagination contract.
 */

export interface ListPlan {
  skip: number;
  take: number;
  orderBy: Record<string, unknown>;
}

/**
 * `sortable` maps an API sort key to a Prisma path. A key that is not in the map is
 * rejected rather than ignored, because silently sorting by something else is worse
 * than an error: the operator reads the wrong rows and never knows.
 */
export function planList(
  query: AdminListQuery,
  sortable: Record<string, string>,
  fallbackSort: string,
): ListPlan {
  const key = query.sort ?? fallbackSort;
  const path = sortable[key];

  if (!path) {
    throw new BadRequestException({
      code: 'INVALID_SORT',
      message: `Cannot sort by "${key}"`,
      details: { allowed: Object.keys(sortable) },
    });
  }

  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    orderBy: nest(path, query.order),
  };
}

/** `product.name` + `asc` -> `{ product: { name: 'asc' } }`. */
function nest(path: string, order: 'asc' | 'desc'): Record<string, unknown> {
  return path
    .split('.')
    .reverse()
    .reduce<Record<string, unknown> | string>((acc, segment) => ({ [segment]: acc }), order) as Record<
    string,
    unknown
  >;
}

export function listMeta(query: AdminListQuery, total: number): AdminListMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
  };
}

export function listResponse<T>(
  query: AdminListQuery,
  items: T[],
  total: number,
): AdminListResponse<T> {
  return { data: items, meta: listMeta(query, total) };
}

/**
 * Free-text search across several string columns. Case- and accent-insensitivity comes
 * from Postgres; `mode: 'insensitive'` is enough for the columns admins actually search.
 */
export function searchFilter(
  term: string | undefined,
  fields: string[],
): Record<string, unknown> | undefined {
  const value = term?.trim();
  if (!value) return undefined;
  return {
    OR: fields.map((field) => nestContains(field, value)),
  };
}

function nestContains(path: string, value: string): Record<string, unknown> {
  const condition = { contains: value, mode: 'insensitive' as const };
  return path
    .split('.')
    .reverse()
    .reduce<Record<string, unknown> | typeof condition>(
      (acc, segment) => ({ [segment]: acc }),
      condition,
    ) as Record<string, unknown>;
}

/** Combines optional filter fragments, dropping the undefined ones. */
export function andWhere(
  ...parts: Array<Record<string, unknown> | undefined | false>
): Record<string, unknown> {
  const clauses = parts.filter((part): part is Record<string, unknown> => Boolean(part));
  return clauses.length === 0 ? {} : { AND: clauses };
}

/**
 * An export ignores pagination but not sanity: a request that would stream the whole
 * database is refused with a message telling the operator to narrow it.
 */
export function planExport(total: number): { take: number } {
  if (total > EXPORT_MAX_ROWS) {
    throw new BadRequestException({
      code: 'EXPORT_TOO_LARGE',
      message: `That export would contain ${total} rows. Narrow the filters to ${EXPORT_MAX_ROWS} or fewer.`,
    });
  }
  return { take: total };
}

/**
 * Parses `filter[status]=A&filter[status]=B` into `{ status: ['A','B'] }`.
 *
 * Express's default query parser is `qs`, which has already turned the bracket syntax
 * into a nested `{ filter: { status: [...] } }` object by the time a controller sees
 * it. Flat `filter[...]` keys are handled too, because a client that encodes the
 * brackets (`filter%5Bstatus%5D`) produces exactly that, and both must work.
 */
export function parseFilters(raw: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  const nested = raw.filter;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      out[key] = normalizeValues(value);
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    const match = /^filter\[([a-zA-Z0-9_.]+)\]$/.exec(key);
    if (!match?.[1]) continue;
    out[match[1]] = normalizeValues(value);
  }

  return out;
}

function normalizeValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => item !== null && item !== undefined)
    .map(String)
    .filter((item) => item !== '');
}
