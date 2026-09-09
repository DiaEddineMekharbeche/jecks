import { BadRequestException } from '@nestjs/common';
import type { AdminListQuery } from '@jecks/shared';
import { describe, expect, it } from 'vitest';
import { __exportInternals } from './export.service.js';
import {
  andWhere,
  listMeta,
  listResponse,
  parseFilters,
  planExport,
  planList,
  searchFilter,
} from './list.helper.js';

const query = (overrides: Partial<AdminListQuery> = {}): AdminListQuery => ({
  page: 1,
  pageSize: 50,
  order: 'desc',
  ...overrides,
});

const SORTABLE = {
  createdAt: 'createdAt',
  total: 'total',
  customer: 'customer.fullName',
};

describe('planList', () => {
  it('translates page and size into skip and take', () => {
    expect(planList(query({ page: 3, pageSize: 25 }), SORTABLE, 'createdAt')).toMatchObject({
      skip: 50,
      take: 25,
    });
  });

  it('starts at zero on the first page', () => {
    expect(planList(query(), SORTABLE, 'createdAt').skip).toBe(0);
  });

  it('builds orderBy from the whitelist', () => {
    expect(planList(query({ sort: 'total', order: 'asc' }), SORTABLE, 'createdAt').orderBy).toEqual({
      total: 'asc',
    });
  });

  it('nests a dotted path into a relation sort', () => {
    expect(planList(query({ sort: 'customer' }), SORTABLE, 'createdAt').orderBy).toEqual({
      customer: { fullName: 'desc' },
    });
  });

  it('falls back to the module default when no sort is given', () => {
    expect(planList(query(), SORTABLE, 'createdAt').orderBy).toEqual({ createdAt: 'desc' });
  });

  it('rejects a sort key outside the whitelist rather than ignoring it', () => {
    // Silently sorting by something else shows the operator the wrong rows.
    expect(() => planList(query({ sort: 'passwordHash' }), SORTABLE, 'createdAt')).toThrow(
      BadRequestException,
    );
  });

  it('names the allowed keys in the error', () => {
    try {
      planList(query({ sort: 'nope' }), SORTABLE, 'createdAt');
      expect.unreachable('should have thrown');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        details: { allowed: string[] };
      };
      expect(body.code).toBe('INVALID_SORT');
      expect(body.details.allowed).toEqual(['createdAt', 'total', 'customer']);
    }
  });
});

describe('listMeta', () => {
  it('computes the page count', () => {
    expect(listMeta(query({ pageSize: 25 }), 101)).toEqual({
      page: 1,
      pageSize: 25,
      total: 101,
      totalPages: 5,
    });
  });

  it('reports one page when there is nothing, so the UI has no zero state to special-case', () => {
    expect(listMeta(query(), 0).totalPages).toBe(1);
  });

  it('wraps rows in the list envelope', () => {
    expect(listResponse(query(), [{ id: 'a' }], 1)).toEqual({
      data: [{ id: 'a' }],
      meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    });
  });
});

describe('searchFilter', () => {
  it('builds a case-insensitive OR across the given columns', () => {
    expect(searchFilter('atlas', ['number', 'customerName'])).toEqual({
      OR: [
        { number: { contains: 'atlas', mode: 'insensitive' } },
        { customerName: { contains: 'atlas', mode: 'insensitive' } },
      ],
    });
  });

  it('nests a relation path', () => {
    expect(searchFilter('yac', ['customer.fullName'])).toEqual({
      OR: [{ customer: { fullName: { contains: 'yac', mode: 'insensitive' } } }],
    });
  });

  it('returns undefined for an empty term, so it drops out of the where clause', () => {
    expect(searchFilter(undefined, ['number'])).toBeUndefined();
    expect(searchFilter('   ', ['number'])).toBeUndefined();
  });
});

describe('andWhere', () => {
  it('drops absent fragments', () => {
    expect(andWhere({ status: 'PENDING' }, undefined, false, { wilayaCode: 16 })).toEqual({
      AND: [{ status: 'PENDING' }, { wilayaCode: 16 }],
    });
  });

  it('returns an empty filter when nothing applies', () => {
    expect(andWhere(undefined, false)).toEqual({});
  });
});

describe('planExport', () => {
  it('allows an export within the ceiling', () => {
    expect(planExport(4_000)).toEqual({ take: 4_000 });
  });

  it('refuses an export that would stream the whole database', () => {
    expect(() => planExport(80_000)).toThrow(BadRequestException);
  });
});

describe('parseFilters', () => {
  it('reads the nested shape Express `qs` produces', () => {
    // This is what a controller actually receives for filter[status]=A&filter[status]=B.
    expect(
      parseFilters({ filter: { status: ['PENDING', 'CONFIRMED'], wilayaCode: '16' }, page: '2' }),
    ).toEqual({ status: ['PENDING', 'CONFIRMED'], wilayaCode: ['16'] });
  });

  it('also reads flat bracket keys, which is what percent-encoded clients send', () => {
    expect(parseFilters({ 'filter[status]': ['PENDING', 'CONFIRMED'], page: '2' })).toEqual({
      status: ['PENDING', 'CONFIRMED'],
    });
  });

  it('wraps a single value', () => {
    expect(parseFilters({ filter: { wilayaCode: '16' } })).toEqual({ wilayaCode: ['16'] });
  });

  it('ignores anything that is not a filter param', () => {
    expect(parseFilters({ sort: 'createdAt', q: 'atlas' })).toEqual({});
  });

  it('drops empty values so a cleared filter does not become a match on ""', () => {
    expect(parseFilters({ filter: { status: '' } })).toEqual({ status: [] });
    expect(parseFilters({ filter: { status: [null, 'PENDING'] } })).toEqual({ status: ['PENDING'] });
  });
});

describe('csv escaping', () => {
  const { csvCell } = __exportInternals;

  it('leaves a plain value alone', () => {
    expect(csvCell('Trucker Atlas')).toBe('Trucker Atlas');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('Casquette "Lin"')).toBe('"Casquette ""Lin"""');
  });

  it('quotes values containing a comma or a newline', () => {
    expect(csvCell('Alger, Centre')).toBe('"Alger, Centre"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders a date as an ISO instant', () => {
    expect(csvCell(new Date('2026-09-09T10:00:00.000Z'))).toBe('2026-09-09T10:00:00.000Z');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});
