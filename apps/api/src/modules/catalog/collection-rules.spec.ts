import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  MATCHES_NOTHING,
  __ruleInternals,
  assertRulesValid,
  ruleToFilter,
  rulesToFilter,
} from './collection-rules.js';

const rule = (field: string, operator: string, value: string) => ({ field, operator, value });

describe('ruleToFilter', () => {
  it('matches a tag by slug, and negates it for NOT_EQUALS', () => {
    expect(ruleToFilter(rule('TAG', 'EQUALS', 'nouveaute'))).toEqual({
      tags: { some: { tag: { slug: 'nouveaute' } } },
    });
    expect(ruleToFilter(rule('TAG', 'NOT_EQUALS', 'solde'))).toEqual({
      tags: { none: { tag: { slug: { in: ['solde'] } } } },
    });
  });

  it('splits an IN rule on commas', () => {
    expect(ruleToFilter(rule('TAG', 'IN', 'nouveaute, coton , ete'))).toEqual({
      tags: { some: { tag: { slug: { in: ['nouveaute', 'coton', 'ete'] } } } },
    });
  });

  it('compares price against the cached minimum, in centimes', () => {
    expect(ruleToFilter(rule('PRICE', 'LESS_THAN', '350000'))).toEqual({
      minPrice: { lt: 350_000n },
    });
    expect(ruleToFilter(rule('PRICE', 'GREATER_THAN', '250000'))).toEqual({
      minPrice: { gt: 250_000n },
    });
  });

  it('reads DISCOUNT as "currently marked down"', () => {
    expect(ruleToFilter(rule('DISCOUNT', 'GREATER_THAN', '0'))).toEqual({
      maxCompareAt: { not: null },
    });
  });

  it('turns a relative window into an absolute date', () => {
    const now = new Date('2026-09-09T12:00:00Z');
    const since = __ruleInternals.parseSince(rule('CREATED_AT', 'GREATER_THAN', '-30d'), now);
    expect(since.toISOString()).toBe('2026-08-10T12:00:00.000Z');
  });

  it('accepts an absolute date too', () => {
    const since = __ruleInternals.parseSince(rule('CREATED_AT', 'GREATER_THAN', '2026-01-01'));
    expect(since.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('searches the French title for CONTAINS', () => {
    expect(ruleToFilter(rule('TITLE', 'CONTAINS', 'trucker'))).toEqual({
      name: { path: ['fr'], string_contains: 'trucker' },
    });
  });

  it('rejects a price rule that is not a whole number of centimes', () => {
    expect(() => ruleToFilter(rule('PRICE', 'GREATER_THAN', '29,90'))).toThrow(BadRequestException);
  });

  it('rejects an unknown field rather than matching everything', () => {
    expect(() => ruleToFilter(rule('COLOUR', 'EQUALS', 'noir'))).toThrow(BadRequestException);
  });
});

describe('rulesToFilter', () => {
  it('ANDs the rules when every one must match', () => {
    const filter = rulesToFilter(
      [rule('TAG', 'EQUALS', 'nouveaute'), rule('STOCK', 'GREATER_THAN', '0')],
      true,
    );
    expect(filter).toEqual({
      AND: [{ tags: { some: { tag: { slug: 'nouveaute' } } } }, { totalStock: { gt: 0 } }],
    });
  });

  it('ORs them when any rule is enough', () => {
    const filter = rulesToFilter([rule('BRAND', 'EQUALS', 'jecks')], false);
    expect(filter).toEqual({ OR: [{ brand: { slug: 'jecks' } }] });
  });

  it('matches nothing when a smart collection has no rules', () => {
    // The alternative — an empty filter — would put the whole catalogue in the
    // collection, which is the worst possible failure for this feature.
    expect(rulesToFilter([], true)).toBe(MATCHES_NOTHING);
  });
});

describe('assertRulesValid', () => {
  it('passes a usable rule set', () => {
    expect(() => assertRulesValid([rule('STOCK', 'LESS_THAN', '5')])).not.toThrow();
  });

  it('throws on the first unusable rule so nothing bad is stored', () => {
    expect(() =>
      assertRulesValid([rule('TAG', 'EQUALS', 'ok'), rule('STOCK', 'LESS_THAN', 'beaucoup')]),
    ).toThrow(BadRequestException);
  });
});
