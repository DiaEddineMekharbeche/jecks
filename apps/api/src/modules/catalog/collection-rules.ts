import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';

/**
 * Smart-collection rules, translated into a Prisma filter — PRD F-AD-11.
 *
 * One translator serves both readers. The storefront resolves a collection to its rules
 * on every request (so a rule change is live immediately, never materialized), and the
 * admin rule builder previews the same filter before saving. If these were two
 * implementations, the preview would eventually lie about what shoppers see.
 */

export interface RuleLike {
  field: string;
  operator: string;
  value: string;
}

/** A filter that matches nothing — an unknown collection must not return the catalogue. */
export const MATCHES_NOTHING: Prisma.ProductWhereInput = {
  id: '00000000-0000-0000-0000-000000000000',
};

export function rulesToFilter(rules: RuleLike[], matchAll: boolean): Prisma.ProductWhereInput {
  const filters = rules.map(ruleToFilter);
  if (filters.length === 0) return MATCHES_NOTHING;
  return matchAll ? { AND: filters } : { OR: filters };
}

export function ruleToFilter(rule: RuleLike): Prisma.ProductWhereInput {
  const { field, operator } = rule;
  const value = rule.value.trim();

  switch (field) {
    case 'TAG':
      return tagFilter(operator, value);
    case 'CATEGORY':
      return relationSlugFilter('category', operator, value);
    case 'BRAND':
      return relationSlugFilter('brand', operator, value);
    case 'PRICE':
      return { minPrice: numericComparison(operator, parseMoney(rule)) };
    case 'DISCOUNT':
      // The rollups carry the highest compare-at price and the lowest selling price,
      // not a discount percentage, so this is "currently marked down" rather than
      // "marked down by more than N %". D25 explains why the percentage is not stored.
      return operator === 'LESS_THAN' ? { maxCompareAt: null } : { maxCompareAt: { not: null } };
    case 'STOCK':
      return { totalStock: numericComparison(operator, parseInteger(rule)) };
    case 'CREATED_AT':
      return { publishedAt: dateComparison(operator, parseSince(rule)) };
    case 'TITLE':
      return titleFilter(operator, value);
    default:
      throw new BadRequestException({
        code: 'INVALID_RULE',
        message: `Unknown rule field "${field}"`,
      });
  }
}

function tagFilter(operator: string, value: string): Prisma.ProductWhereInput {
  const slugs = splitList(value);
  switch (operator) {
    case 'NOT_EQUALS':
      return { tags: { none: { tag: { slug: { in: slugs } } } } };
    case 'IN':
      return { tags: { some: { tag: { slug: { in: slugs } } } } };
    case 'CONTAINS':
      return { tags: { some: { tag: { slug: { contains: value, mode: 'insensitive' } } } } };
    default:
      return { tags: { some: { tag: { slug: value } } } };
  }
}

/** Brand and category both hang off a slug, so one shape covers them. */
function relationSlugFilter(
  relation: 'brand' | 'category',
  operator: string,
  value: string,
): Prisma.ProductWhereInput {
  const slugs = splitList(value);
  if (operator === 'NOT_EQUALS') {
    return { NOT: { [relation]: { slug: { in: slugs } } } } as Prisma.ProductWhereInput;
  }
  if (operator === 'IN') {
    return { [relation]: { slug: { in: slugs } } } as Prisma.ProductWhereInput;
  }
  return { [relation]: { slug: value } } as Prisma.ProductWhereInput;
}

function titleFilter(operator: string, value: string): Prisma.ProductWhereInput {
  // `name` is JSONB; the French value is the one that is always present (D08).
  if (operator === 'NOT_EQUALS') {
    return { NOT: { name: { path: ['fr'], string_contains: value } } };
  }
  if (operator === 'EQUALS') {
    return { name: { path: ['fr'], equals: value } };
  }
  return { name: { path: ['fr'], string_contains: value } };
}

function numericComparison<T extends bigint | number>(
  operator: string,
  value: T,
): Record<string, T> {
  switch (operator) {
    case 'LESS_THAN':
      return { lt: value };
    case 'EQUALS':
      return { equals: value };
    case 'NOT_EQUALS':
      return { not: value };
    default:
      return { gt: value };
  }
}

function dateComparison(operator: string, value: Date): Record<string, Date> {
  return operator === 'LESS_THAN' ? { lte: value } : { gte: value };
}

/** `IN` rules carry their list in one column, comma-separated. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMoney(rule: RuleLike): bigint {
  const raw = rule.value.trim();
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException({
      code: 'INVALID_RULE',
      message: 'A price rule takes a whole number of centimes',
      details: { field: rule.field, value: rule.value },
    });
  }
  return BigInt(raw);
}

function parseInteger(rule: RuleLike): number {
  const parsed = Number(rule.value.trim());
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException({
      code: 'INVALID_RULE',
      message: 'A stock rule takes a whole number',
      details: { field: rule.field, value: rule.value },
    });
  }
  return parsed;
}

/**
 * A relative window like `-30d` is what keeps a "Nouveautés" collection rolling; an
 * absolute date is accepted too, for a collection tied to one drop.
 */
function parseSince(rule: RuleLike, now = new Date()): Date {
  const raw = rule.value.trim();
  const relative = /^-(\d{1,4})d$/.exec(raw);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * 86_400_000);

  const absolute = new Date(raw);
  if (Number.isNaN(absolute.getTime())) {
    throw new BadRequestException({
      code: 'INVALID_RULE',
      message: 'A date rule takes an ISO date or a relative window such as -30d',
      details: { field: rule.field, value: rule.value },
    });
  }
  return absolute;
}

/** Throws on the first unusable rule, so a bad rule set never reaches the database. */
export function assertRulesValid(rules: RuleLike[]): void {
  for (const rule of rules) ruleToFilter(rule);
}

export const __ruleInternals = { parseSince, parseMoney, parseInteger, splitList };
