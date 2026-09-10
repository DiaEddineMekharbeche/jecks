import { describe, expect, it } from 'vitest';
import { computeTotals, divideRoundHalfUp, loyaltyDiscount, taxPortion, type TotalsInput } from './totals.js';

/**
 * Order totals — PRD Section 7.
 *
 * The same calculator prices a web checkout and a phoned-in order, so what is defended
 * here is that it adds up: the total is always the sum of its parts, no discount
 * exceeds what there is to discount, and the per-line allocation always sums back to
 * the order-level figure.
 */

function line(overrides: Partial<TotalsInput['lines'][number]> & { id: string }) {
  return {
    quantity: 1,
    unitPriceMinor: 200_000n,
    unitCostMinor: 80_000n,
    weightGrams: 180,
    ...overrides,
  };
}

function input(overrides: Partial<TotalsInput> = {}): TotalsInput {
  return {
    lines: [line({ id: 'a' })],
    discountByLine: {},
    shippingMinor: 50_000n,
    loyaltyPoints: 0,
    pointValueMinor: 500n,
    loyaltyMaxPercent: 20,
    vatPercent: 19,
    pricesIncludeTax: true,
    ...overrides,
  };
}

describe('computeTotals', () => {
  it('adds the lines, then the shipping', () => {
    const totals = computeTotals(
      input({ lines: [line({ id: 'a' }), line({ id: 'b', quantity: 2, unitPriceMinor: 150_000n })] }),
    );

    expect(totals.itemsSubtotalMinor).toBe(500_000n);
    expect(totals.totalMinor).toBe(550_000n);
    expect(totals.itemCount).toBe(3);
  });

  it('subtracts the promotional discount before the shipping', () => {
    const totals = computeTotals(input({ discountByLine: { a: 40_000n } }));

    expect(totals.discountTotalMinor).toBe(40_000n);
    expect(totals.totalMinor).toBe(210_000n);
  });

  it('freezes the cost of goods for the P&L', () => {
    const totals = computeTotals(
      input({ lines: [line({ id: 'a', quantity: 3, unitCostMinor: 80_000n })] }),
    );
    expect(totals.cogsTotalMinor).toBe(240_000n);
  });

  it('sums the weight so the shipping quote is right', () => {
    const totals = computeTotals(
      input({
        lines: [line({ id: 'a', quantity: 2, weightGrams: 180 }), line({ id: 'b', weightGrams: 400 })],
      }),
    );
    expect(totals.weightGrams).toBe(760);
  });

  it('always adds up', () => {
    const totals = computeTotals(
      input({
        lines: [line({ id: 'a', quantity: 2 }), line({ id: 'b', unitPriceMinor: 333_300n })],
        discountByLine: { a: 37_000n, b: 11_111n },
        loyaltyPoints: 50,
      }),
    );

    expect(totals.totalMinor).toBe(
      totals.itemsSubtotalMinor -
        totals.discountTotalMinor -
        totals.loyaltyDiscountMinor +
        totals.shippingTotalMinor,
    );
  });

  it('allocates every centime of both discounts across the lines', () => {
    const totals = computeTotals(
      input({
        lines: [
          line({ id: 'a', unitPriceMinor: 100_000n }),
          line({ id: 'b', unitPriceMinor: 200_000n }),
          line({ id: 'c', unitPriceMinor: 300_000n }),
        ],
        discountByLine: { a: 5_000n, b: 10_000n, c: 15_000n },
        loyaltyPoints: 100,
      }),
    );

    const allocated = Object.values(totals.lineDiscounts).reduce((sum, value) => sum + value, 0n);
    expect(allocated).toBe(totals.discountTotalMinor + totals.loyaltyDiscountMinor);
  });

  it('handles an empty order without dividing by zero', () => {
    const totals = computeTotals(input({ lines: [], shippingMinor: 0n, loyaltyPoints: 200 }));

    expect(totals.itemsSubtotalMinor).toBe(0n);
    expect(totals.loyaltyDiscountMinor).toBe(0n);
    expect(totals.totalMinor).toBe(0n);
  });
});

describe('loyalty', () => {
  it('spends the points the shopper asked for', () => {
    // 100 points at 5 DA each = 500 DA, well inside the 20 % ceiling of a 5 000 DA cart.
    const totals = computeTotals(
      input({ lines: [line({ id: 'a', unitPriceMinor: 500_000n })], loyaltyPoints: 100 }),
    );

    expect(totals.loyaltyDiscountMinor).toBe(50_000n);
    expect(totals.loyaltyPointsUsed).toBe(100);
  });

  it('caps the discount at the shop’s percentage ceiling', () => {
    // 20 % of 2 000 DA is 400 DA, so only 80 of the 300 points can be spent.
    const totals = computeTotals(
      input({ lines: [line({ id: 'a' })], loyaltyPoints: 300 }),
    );

    expect(totals.loyaltyDiscountMinor).toBe(40_000n);
    expect(totals.loyaltyPointsUsed).toBe(80);
  });

  it('never charges for more points than the discount actually granted', () => {
    const { amountMinor, pointsUsed } = loyaltyDiscount(300, 500n, 200_000n, 20);
    expect(amountMinor).toBe(BigInt(pointsUsed) * 500n);
  });

  it('measures the ceiling after the promotional discount', () => {
    // 2 000 DA less a 1 000 DA promo leaves 1 000 DA, so the ceiling is 200 DA.
    const totals = computeTotals(
      input({ discountByLine: { a: 100_000n }, loyaltyPoints: 300 }),
    );
    expect(totals.loyaltyDiscountMinor).toBe(20_000n);
  });

  it('spends nothing when the shop has disabled the programme', () => {
    const totals = computeTotals(input({ loyaltyPoints: 500, pointValueMinor: 0n }));
    expect(totals.loyaltyDiscountMinor).toBe(0n);
    expect(totals.loyaltyPointsUsed).toBe(0);
  });

  it('spends nothing on a cart with nothing left to pay for', () => {
    const totals = computeTotals(
      input({ discountByLine: { a: 200_000n }, loyaltyPoints: 100 }),
    );
    expect(totals.loyaltyDiscountMinor).toBe(0n);
  });

  it('ignores a negative or fractional point request', () => {
    expect(loyaltyDiscount(-50, 500n, 200_000n, 20).pointsUsed).toBe(0);
    expect(loyaltyDiscount(10.9, 500n, 200_000n, 20).pointsUsed).toBe(10);
  });
});

describe('tax', () => {
  it('splits the VAT out of a tax-inclusive total', () => {
    // 1 190 DA at 19 % inclusive: 190 DA of it is tax.
    expect(taxPortion(119_000n, { vatPercent: 19, pricesIncludeTax: true })).toBe(19_000n);
  });

  it('adds the VAT on top when prices are quoted excluding it', () => {
    expect(taxPortion(100_000n, { vatPercent: 19, pricesIncludeTax: false })).toBe(19_000n);
  });

  it('is zero when the shop charges no VAT', () => {
    expect(taxPortion(500_000n, { vatPercent: 0, pricesIncludeTax: true })).toBe(0n);
  });

  it('is zero on an empty order', () => {
    expect(taxPortion(0n, { vatPercent: 19, pricesIncludeTax: true })).toBe(0n);
  });

  it('never exceeds the total it was taken from', () => {
    for (const total of [1n, 999n, 123_456n]) {
      expect(taxPortion(total, { vatPercent: 19, pricesIncludeTax: true })).toBeLessThan(total + 1n);
    }
  });
});

describe('divideRoundHalfUp', () => {
  it('rounds a half away from zero', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
  });

  it('returns zero rather than throwing on a zero denominator', () => {
    expect(divideRoundHalfUp(5n, 0n)).toBe(0n);
  });
});
