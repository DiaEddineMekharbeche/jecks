import { PromotionScope, PromotionType } from '@jecks/shared';
import { describe, expect, it } from 'vitest';
import { applyPromotions, divideRoundHalfUp, subtotalOf } from './promo-engine.js';
import type { CartLine, PromoContext, PromoRule } from './types.js';

/**
 * The promo engine, exercised as a table of carts and rules — PRD-COMPLETION M3.1.
 *
 * The engine is pure, so every case here is the whole truth about that scenario: no
 * database, no clock, no ordering surprises. What is being defended is the arithmetic
 * (rounding, clamping, allocation) and the refusals, because both are what a shopper
 * sees when they type a code.
 */

const NOW = new Date('2026-09-10T12:00:00.000Z');

function line(overrides: Partial<CartLine> & Pick<CartLine, 'id'>): CartLine {
  return {
    variantId: `variant-${overrides.id}`,
    productId: `product-${overrides.id}`,
    categoryId: 'category-caps',
    collectionIds: [],
    quantity: 1,
    unitPriceMinor: 100_000n,
    ...overrides,
  };
}

function context(overrides: Partial<PromoContext> = {}): PromoContext {
  return {
    lines: [line({ id: 'a' })],
    customer: { id: 'customer-1', groupId: null, orderCount: 2, usageByPromotion: {} },
    wilayaCode: 16,
    codes: [],
    shippingMinor: 50_000n,
    now: NOW,
    ...overrides,
  };
}

function rule(overrides: Partial<PromoRule> & Pick<PromoRule, 'id' | 'type'>): PromoRule {
  return {
    name: `Promotion ${overrides.id}`,
    scope: PromotionScope.ORDER,
    code: null,
    percentOff: null,
    amountOffMinor: null,
    bundlePriceMinor: null,
    buyXGetY: null,
    tiers: [],
    minSubtotalMinor: null,
    minQuantity: null,
    firstOrderOnly: false,
    wilayaCodes: [],
    productIds: [],
    variantIds: [],
    collectionIds: [],
    categoryIds: [],
    customerGroupIds: [],
    usageLimitTotal: null,
    usageLimitPerCustomer: null,
    usageCount: 0,
    stackable: false,
    priority: 100,
    startsAt: null,
    endsAt: null,
    active: true,
    ...overrides,
  };
}

// --- percentage -------------------------------------------------------------

describe('percentage promotions', () => {
  it('takes the percentage off every covered line', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a' }), line({ id: 'b', unitPriceMinor: 200_000n })] }),
      [rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 10 })],
    );

    expect(result.discountMinor).toBe(30_000n);
    expect(result.subtotalMinor).toBe(300_000n);
    expect(result.totalMinor).toBe(320_000n);
  });

  it('rounds a fractional percentage half-up, once per line', () => {
    // 1 999,00 DA at 7,5 % = 149,925 DA -> 149,93 DA
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', unitPriceMinor: 199_900n })] }),
      [rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 7.5 })],
    );
    expect(result.discountMinor).toBe(14_993n);
  });

  it('applies the percentage to the line total, not to a rounded unit price', () => {
    // 3 x 33,33 DA. Per-unit rounding would give 3 x 3 = 9 centimes off at 10 %;
    // the line total (99,99 DA) gives 10 centimes, which is what the invoice says.
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', quantity: 3, unitPriceMinor: 3_333n })] }),
      [rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 10 })],
    );
    expect(result.discountMinor).toBe(1_000n);
  });

  it('grants nothing for a zero percentage and says so', () => {
    const result = applyPromotions(context(), [
      rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 0, code: 'ZERO' }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ reason: 'NOT_ELIGIBLE' });
  });

  it('never discounts an excluded line', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a' }), line({ id: 'gift', excluded: true })] }),
      [rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 50 })],
    );
    expect(result.lineDiscounts).toEqual([{ lineId: 'a', amountMinor: 50_000n }]);
  });
});

// --- fixed amount -----------------------------------------------------------

describe('fixed amount promotions', () => {
  it('spreads the amount across lines in proportion to value', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', unitPriceMinor: 100_000n }),
          line({ id: 'b', unitPriceMinor: 300_000n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.FIXED_AMOUNT, amountOffMinor: 40_000n })],
    );

    expect(result.discountMinor).toBe(40_000n);
    expect(result.lineDiscounts).toEqual([
      { lineId: 'a', amountMinor: 10_000n },
      { lineId: 'b', amountMinor: 30_000n },
    ]);
  });

  it('always allocates exactly the amount promised, remainder to the largest line', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', unitPriceMinor: 33_300n }),
          line({ id: 'b', unitPriceMinor: 33_300n }),
          line({ id: 'c', unitPriceMinor: 33_400n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.FIXED_AMOUNT, amountOffMinor: 10_000n })],
    );

    expect(result.discountMinor).toBe(10_000n);
    expect(result.lineDiscounts.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(10_000n);
  });

  it('cannot take more off than the cart is worth', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', unitPriceMinor: 30_000n })] }),
      [rule({ id: 'p1', type: PromotionType.FIXED_AMOUNT, amountOffMinor: 500_000n })],
    );

    expect(result.discountMinor).toBe(30_000n);
    expect(result.totalMinor).toBe(50_000n); // shipping only
  });
});

// --- free shipping ----------------------------------------------------------

describe('free shipping', () => {
  it('zeroes the shipping without touching the merchandise', () => {
    const result = applyPromotions(context(), [
      rule({ id: 'p1', type: PromotionType.FREE_SHIPPING, scope: PromotionScope.SHIPPING }),
    ]);

    expect(result.freeShipping).toBe(true);
    expect(result.shippingMinor).toBe(0n);
    expect(result.discountMinor).toBe(0n);
    expect(result.totalMinor).toBe(100_000n);
  });

  it('applies even when there is nothing left to discount', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', excluded: true })] }),
      [rule({ id: 'p1', type: PromotionType.FREE_SHIPPING })],
    );
    expect(result.freeShipping).toBe(true);
  });
});

// --- tiered -----------------------------------------------------------------

describe('tiered promotions', () => {
  const tiers = [
    { minSubtotalMinor: 500_000n, percentOff: 5 },
    { minSubtotalMinor: 1_000_000n, percentOff: 10 },
    { minSubtotalMinor: 2_000_000n, percentOff: 15 },
  ];

  it('picks the highest tier the cart has reached', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', unitPriceMinor: 1_200_000n })] }),
      [rule({ id: 'p1', type: PromotionType.TIERED, tiers })],
    );
    expect(result.discountMinor).toBe(120_000n);
  });

  it('grants nothing below the first tier', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', unitPriceMinor: 400_000n })], codes: ['TIER'] }),
      [rule({ id: 'p1', type: PromotionType.TIERED, tiers, code: 'TIER' })],
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('NOT_ELIGIBLE');
  });

  it('treats a boundary as reached', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', unitPriceMinor: 1_000_000n })] }),
      [rule({ id: 'p1', type: PromotionType.TIERED, tiers })],
    );
    expect(result.discountMinor).toBe(100_000n);
  });
});

// --- buy X get Y ------------------------------------------------------------

describe('buy X get Y', () => {
  const offer = { buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100 };

  it('gives the cheapest unit away once the group is complete', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', quantity: 2, unitPriceMinor: 200_000n }),
          line({ id: 'b', quantity: 1, unitPriceMinor: 80_000n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.BUY_X_GET_Y, buyXGetY: offer })],
    );

    expect(result.discountMinor).toBe(80_000n);
    expect(result.lineDiscounts).toEqual([{ lineId: 'b', amountMinor: 80_000n }]);
  });

  it('grants nothing until the group is complete', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', quantity: 2 })], codes: ['BXGY'] }),
      [rule({ id: 'p1', type: PromotionType.BUY_X_GET_Y, buyXGetY: offer, code: 'BXGY' })],
    );
    expect(result.applied).toHaveLength(0);
  });

  it('repeats for each complete group and ignores the remainder', () => {
    // 7 units at 100 DA: two complete groups of three, one unit left over.
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', quantity: 7, unitPriceMinor: 100_000n })] }),
      [rule({ id: 'p1', type: PromotionType.BUY_X_GET_Y, buyXGetY: offer })],
    );
    expect(result.discountMinor).toBe(200_000n);
  });

  it('honours a partial discount on the free units', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', quantity: 3, unitPriceMinor: 100_000n })] }),
      [
        rule({
          id: 'p1',
          type: PromotionType.BUY_X_GET_Y,
          buyXGetY: { buyQuantity: 2, getQuantity: 1, getDiscountPercent: 50 },
        }),
      ],
    );
    expect(result.discountMinor).toBe(50_000n);
  });

  it('counts units across lines of the same promotion scope', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', quantity: 1, unitPriceMinor: 100_000n }),
          line({ id: 'b', quantity: 1, unitPriceMinor: 100_000n }),
          line({ id: 'c', quantity: 1, unitPriceMinor: 60_000n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.BUY_X_GET_Y, buyXGetY: offer })],
    );
    expect(result.discountMinor).toBe(60_000n);
  });
});

// --- bundle -----------------------------------------------------------------

describe('bundle price', () => {
  it('discounts down to the bundle price', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', unitPriceMinor: 300_000n }),
          line({ id: 'b', unitPriceMinor: 300_000n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.BUNDLE_PRICE, bundlePriceMinor: 490_000n })],
    );

    expect(result.discountMinor).toBe(110_000n);
    expect(result.subtotalMinor - result.discountMinor).toBe(490_000n);
  });

  it('grants nothing when the cart is already cheaper than the bundle', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', unitPriceMinor: 100_000n })], codes: ['BUNDLE'] }),
      [
        rule({
          id: 'p1',
          type: PromotionType.BUNDLE_PRICE,
          bundlePriceMinor: 490_000n,
          code: 'BUNDLE',
        }),
      ],
    );
    expect(result.applied).toHaveLength(0);
  });
});

// --- scoping ----------------------------------------------------------------

describe('scoping', () => {
  it('only discounts the products it names', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', productId: 'product-cap' }),
          line({ id: 'b', productId: 'product-tee' }),
        ],
      }),
      [
        rule({
          id: 'p1',
          type: PromotionType.PERCENTAGE,
          percentOff: 20,
          productIds: ['product-cap'],
        }),
      ],
    );
    expect(result.lineDiscounts).toEqual([{ lineId: 'a', amountMinor: 20_000n }]);
  });

  it('matches on collection membership', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', collectionIds: ['collection-new'] }),
          line({ id: 'b', collectionIds: ['collection-sale'] }),
        ],
      }),
      [
        rule({
          id: 'p1',
          type: PromotionType.PERCENTAGE,
          percentOff: 10,
          collectionIds: ['collection-new'],
        }),
      ],
    );
    expect(result.lineDiscounts).toEqual([{ lineId: 'a', amountMinor: 10_000n }]);
  });

  it('measures a minimum against the scoped lines, not the whole cart', () => {
    // 3 000 DA of tees must not unlock a "3 000 DA of caps" offer.
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'cap', productId: 'product-cap', unitPriceMinor: 100_000n }),
          line({ id: 'tee', productId: 'product-tee', unitPriceMinor: 300_000n }),
        ],
        codes: ['CAPS'],
      }),
      [
        rule({
          id: 'p1',
          type: PromotionType.PERCENTAGE,
          percentOff: 10,
          productIds: ['product-cap'],
          minSubtotalMinor: 300_000n,
          code: 'CAPS',
        }),
      ],
    );
    expect(result.rejected[0]?.reason).toBe('MIN_SUBTOTAL');
  });

  it('rejects when nothing in the cart matches', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', productId: 'product-tee' })], codes: ['CAPS'] }),
      [
        rule({
          id: 'p1',
          type: PromotionType.PERCENTAGE,
          percentOff: 10,
          productIds: ['product-cap'],
          code: 'CAPS',
        }),
      ],
    );
    expect(result.rejected[0]?.reason).toBe('NOT_ELIGIBLE');
  });
});

// --- eligibility ------------------------------------------------------------

describe('eligibility', () => {
  const cases: Array<[string, Partial<PromoRule>, Partial<PromoContext>, string]> = [
    ['inactive promotion', { active: false }, {}, 'INACTIVE'],
    [
      'not started yet',
      { startsAt: new Date('2026-10-01T00:00:00.000Z') },
      {},
      'NOT_STARTED',
    ],
    ['already expired', { endsAt: new Date('2026-09-01T00:00:00.000Z') }, {}, 'EXPIRED'],
    ['total usage limit reached', { usageLimitTotal: 5, usageCount: 5 }, {}, 'USAGE_LIMIT_REACHED'],
    ['unique code spent', { codeUsesRemaining: 0 }, {}, 'USAGE_LIMIT_REACHED'],
    [
      'customer limit reached',
      { usageLimitPerCustomer: 1 },
      { customer: { id: 'c', groupId: null, orderCount: 1, usageByPromotion: { p1: 1 } } },
      'CUSTOMER_LIMIT_REACHED',
    ],
    ['first order only, but not the first', { firstOrderOnly: true }, {}, 'FIRST_ORDER_ONLY'],
    ['wilaya not covered', { wilayaCodes: [31] }, {}, 'WILAYA_NOT_ELIGIBLE'],
    ['wilaya unknown', { wilayaCodes: [16] }, { wilayaCode: null }, 'WILAYA_NOT_ELIGIBLE'],
    ['wrong customer group', { customerGroupIds: ['vip'] }, {}, 'NOT_ELIGIBLE'],
    ['minimum quantity not met', { minQuantity: 3 }, {}, 'MIN_QUANTITY'],
    ['minimum subtotal not met', { minSubtotalMinor: 500_000n }, {}, 'MIN_SUBTOTAL'],
  ];

  it.each(cases)('rejects: %s', (_label, ruleOverrides, contextOverrides, reason) => {
    const result = applyPromotions(context({ codes: ['CODE'], ...contextOverrides }), [
      rule({
        id: 'p1',
        type: PromotionType.PERCENTAGE,
        percentOff: 10,
        code: 'CODE',
        ...ruleOverrides,
      }),
    ]);

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ reason, promotionId: 'p1' });
    expect(result.rejected[0]?.message).toBeTruthy();
  });

  it('accepts a first-order promotion for a customer with no orders', () => {
    const result = applyPromotions(
      context({ customer: { id: 'c', groupId: null, orderCount: 0, usageByPromotion: {} } }),
      [rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 10, firstOrderOnly: true })],
    );
    expect(result.discountMinor).toBe(10_000n);
  });

  it('accepts a group promotion for a member of that group', () => {
    const result = applyPromotions(
      context({ customer: { id: 'c', groupId: 'vip', orderCount: 4, usageByPromotion: {} } }),
      [
        rule({
          id: 'p1',
          type: PromotionType.PERCENTAGE,
          percentOff: 10,
          customerGroupIds: ['vip'],
        }),
      ],
    );
    expect(result.discountMinor).toBe(10_000n);
  });

  it('reports a code that matches no promotion at all', () => {
    const result = applyPromotions(context({ codes: ['NOPE'] }), []);
    expect(result.rejected).toEqual([
      expect.objectContaining({ code: 'NOPE', reason: 'NOT_FOUND', promotionId: null }),
    ]);
  });
});

// --- stacking and priority --------------------------------------------------

describe('stacking and priority', () => {
  it('stops after a non-stackable promotion and explains why', () => {
    const result = applyPromotions(context({ codes: ['A', 'B'] }), [
      rule({
        id: 'p1',
        type: PromotionType.PERCENTAGE,
        percentOff: 10,
        code: 'A',
        priority: 200,
        stackable: false,
      }),
      rule({
        id: 'p2',
        type: PromotionType.PERCENTAGE,
        percentOff: 5,
        code: 'B',
        priority: 100,
        stackable: true,
      }),
    ]);

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.code).toBe('A');
    expect(result.rejected[0]).toMatchObject({ code: 'B', reason: 'NOT_STACKABLE' });
  });

  it('stacks two stackable promotions, the second on what the first left', () => {
    const result = applyPromotions(context({ codes: ['A', 'B'] }), [
      rule({
        id: 'p1',
        type: PromotionType.PERCENTAGE,
        percentOff: 10,
        code: 'A',
        priority: 200,
        stackable: true,
      }),
      rule({
        id: 'p2',
        type: PromotionType.PERCENTAGE,
        percentOff: 10,
        code: 'B',
        priority: 100,
        stackable: true,
      }),
    ]);

    // 1 000 DA -> 100 DA off, then 10 % of the remaining 900 DA.
    expect(result.applied).toHaveLength(2);
    expect(result.discountMinor).toBe(19_000n);
  });

  it('never lets stacking take a line below zero', () => {
    const result = applyPromotions(context({ codes: ['A', 'B'] }), [
      rule({
        id: 'p1',
        type: PromotionType.FIXED_AMOUNT,
        amountOffMinor: 90_000n,
        code: 'A',
        priority: 200,
        stackable: true,
      }),
      rule({
        id: 'p2',
        type: PromotionType.FIXED_AMOUNT,
        amountOffMinor: 90_000n,
        code: 'B',
        priority: 100,
        stackable: true,
      }),
    ]);

    expect(result.discountMinor).toBe(100_000n);
    expect(result.subtotalMinor - result.discountMinor).toBe(0n);
    expect(result.totalMinor).toBe(50_000n);
  });

  it('prefers the larger discount when two rules share a priority', () => {
    const result = applyPromotions(context({ codes: ['SMALL', 'BIG'] }), [
      rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 5, code: 'SMALL' }),
      rule({ id: 'p2', type: PromotionType.PERCENTAGE, percentOff: 20, code: 'BIG' }),
    ]);

    expect(result.applied[0]?.code).toBe('BIG');
    expect(result.discountMinor).toBe(20_000n);
  });

  it('combines a merchandise discount with free shipping', () => {
    const result = applyPromotions(context({ codes: ['TEN', 'SHIP'] }), [
      rule({
        id: 'p1',
        type: PromotionType.PERCENTAGE,
        percentOff: 10,
        code: 'TEN',
        stackable: true,
        priority: 200,
      }),
      rule({
        id: 'p2',
        type: PromotionType.FREE_SHIPPING,
        code: 'SHIP',
        stackable: true,
        priority: 100,
      }),
    ]);

    expect(result.discountMinor).toBe(10_000n);
    expect(result.shippingMinor).toBe(0n);
    expect(result.totalMinor).toBe(90_000n);
  });

  it('is deterministic when everything ties', () => {
    const rules = [
      rule({ id: 'p2', type: PromotionType.PERCENTAGE, percentOff: 10, code: 'B' }),
      rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 10, code: 'A' }),
    ];
    const first = applyPromotions(context({ codes: ['A', 'B'] }), rules);
    const second = applyPromotions(context({ codes: ['A', 'B'] }), [...rules].reverse());
    expect(first.applied[0]?.promotionId).toBe(second.applied[0]?.promotionId);
  });
});

// --- totals -----------------------------------------------------------------

describe('totals', () => {
  it('returns an untouched cart when there are no rules', () => {
    const result = applyPromotions(context(), []);
    expect(result).toMatchObject({
      applied: [],
      rejected: [],
      discountMinor: 0n,
      shippingMinor: 50_000n,
      totalMinor: 150_000n,
    });
  });

  it('handles an empty cart without dividing by zero', () => {
    const result = applyPromotions(context({ lines: [], codes: ['ANY'] }), [
      rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 10, code: 'ANY' }),
    ]);
    expect(result.subtotalMinor).toBe(0n);
    expect(result.discountMinor).toBe(0n);
    expect(result.rejected[0]?.reason).toBe('NOT_ELIGIBLE');
  });

  it('sums line discounts to the reported total', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', unitPriceMinor: 123_400n }),
          line({ id: 'b', unitPriceMinor: 567_800n, quantity: 2 }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.PERCENTAGE, percentOff: 13 })],
    );

    expect(result.lineDiscounts.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(
      result.discountMinor,
    );
    expect(result.totalMinor).toBe(
      result.subtotalMinor - result.discountMinor + result.shippingMinor,
    );
  });
});

describe('helpers', () => {
  it('sums a cart', () => {
    expect(subtotalOf([line({ id: 'a', quantity: 3, unitPriceMinor: 1_000n })])).toBe(3_000n);
  });

  it('treats a negative quantity as zero', () => {
    expect(subtotalOf([line({ id: 'a', quantity: -2, unitPriceMinor: 1_000n })])).toBe(0n);
  });

  it('rounds half away from zero and never divides by zero', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(1n, 0n)).toBe(0n);
  });
});

// --- allocation edge cases --------------------------------------------------

describe('allocation edge cases', () => {
  it('gives the rounding remainder to the largest line', () => {
    // 100 DA across lines of 100 / 200 / 300 DA: the proportional shares are 16,66 /
    // 33,33 / 50,00, leaving one centime that belongs on the 300 DA line.
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', unitPriceMinor: 10_000n }),
          line({ id: 'b', unitPriceMinor: 20_000n }),
          line({ id: 'c', unitPriceMinor: 30_000n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.FIXED_AMOUNT, amountOffMinor: 10_000n })],
    );

    expect(result.discountMinor).toBe(10_000n);
    const largest = result.lineDiscounts.find((entry) => entry.lineId === 'c');
    expect(largest?.amountMinor).toBe(5_001n);
  });

  it('does not exceed a line when the remainder has nowhere to go', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', unitPriceMinor: 1n }),
          line({ id: 'b', unitPriceMinor: 2n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.FIXED_AMOUNT, amountOffMinor: 3n })],
    );

    expect(result.discountMinor).toBe(3n);
    for (const discount of result.lineDiscounts) {
      expect(discount.amountMinor).toBeLessThanOrEqual(2n);
    }
  });

  it('handles a fixed amount landing exactly on a line boundary', () => {
    const result = applyPromotions(
      context({
        lines: [
          line({ id: 'a', unitPriceMinor: 50_000n }),
          line({ id: 'b', unitPriceMinor: 50_000n }),
        ],
      }),
      [rule({ id: 'p1', type: PromotionType.FIXED_AMOUNT, amountOffMinor: 20_000n })],
    );
    expect(result.lineDiscounts).toEqual([
      { lineId: 'a', amountMinor: 10_000n },
      { lineId: 'b', amountMinor: 10_000n },
    ]);
  });

  it('grants nothing for a zero or negative fixed amount', () => {
    for (const amount of [0n, -500n]) {
      const result = applyPromotions(context({ codes: ['X'] }), [
        rule({ id: 'p1', type: PromotionType.FIXED_AMOUNT, amountOffMinor: amount, code: 'X' }),
      ]);
      expect(result.discountMinor).toBe(0n);
    }
  });

  it('ignores a malformed buy-X-get-Y offer rather than crashing', () => {
    for (const offer of [
      { buyQuantity: 0, getQuantity: 1, getDiscountPercent: 100 },
      { buyQuantity: 2, getQuantity: 0, getDiscountPercent: 100 },
    ]) {
      const result = applyPromotions(
        context({ lines: [line({ id: 'a', quantity: 5 })], codes: ['B'] }),
        [rule({ id: 'p1', type: PromotionType.BUY_X_GET_Y, buyXGetY: offer, code: 'B' })],
      );
      expect(result.applied).toHaveLength(0);
    }
  });

  it('ignores a buy-X-get-Y rule with no offer attached', () => {
    const result = applyPromotions(context({ codes: ['B'] }), [
      rule({ id: 'p1', type: PromotionType.BUY_X_GET_Y, code: 'B' }),
    ]);
    expect(result.applied).toHaveLength(0);
  });

  it('ignores a bundle rule with no price attached', () => {
    const result = applyPromotions(context({ codes: ['B'] }), [
      rule({ id: 'p1', type: PromotionType.BUNDLE_PRICE, code: 'B' }),
    ]);
    expect(result.applied).toHaveLength(0);
  });

  it('discounts a buy-X-get-Y offer against what a stacked promotion left', () => {
    // Three units at 1 000 DA. Half price takes 1 500 DA off, leaving each unit worth
    // 500 DA; the free unit is then worth 500 DA, not the original 1 000.
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', quantity: 3 })], codes: ['HALF', 'BXGY'] }),
      [
        rule({
          id: 'p1',
          type: PromotionType.PERCENTAGE,
          percentOff: 50,
          code: 'HALF',
          priority: 200,
          stackable: true,
        }),
        rule({
          id: 'p2',
          type: PromotionType.BUY_X_GET_Y,
          buyXGetY: { buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100 },
          code: 'BXGY',
          priority: 100,
          stackable: true,
        }),
      ],
    );

    expect(result.applied).toHaveLength(2);
    expect(result.discountMinor).toBe(200_000n);
    expect(result.subtotalMinor - result.discountMinor).toBe(100_000n);
  });

  it('never lets a discount exceed the cart when a rule targets everything', () => {
    const result = applyPromotions(
      context({ lines: [line({ id: 'a', quantity: 3, unitPriceMinor: 100_000n })] }),
      [
        rule({
          id: 'p1',
          type: PromotionType.BUY_X_GET_Y,
          buyXGetY: { buyQuantity: 1, getQuantity: 2, getDiscountPercent: 100 },
        }),
      ],
    );
    expect(result.discountMinor).toBeLessThanOrEqual(result.subtotalMinor);
  });
});
