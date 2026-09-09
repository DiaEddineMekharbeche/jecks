import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  add,
  allocate,
  clampToZero,
  compare,
  discountPercent,
  format,
  fromMajor,
  isNegative,
  isZero,
  marginPercent,
  max,
  min,
  money,
  multiply,
  negate,
  percentOf,
  subtract,
  sum,
  taxIncluded,
  toMajorNumber,
  zero,
} from './index.js';

describe('construction', () => {
  it('takes minor units as bigint, number or string', () => {
    expect(money(2500n).amount).toBe(2500n);
    expect(money(2500).amount).toBe(2500n);
    expect(money('2500').amount).toBe(2500n);
  });

  it('refuses a fractional number of minor units', () => {
    expect(() => money(25.5)).toThrow(TypeError);
  });

  it('defaults to DZD', () => {
    expect(zero().currency).toBe('DZD');
  });
});

describe('fromMajor', () => {
  it('converts a major-unit string to centimes', () => {
    expect(fromMajor('1250.50').amount).toBe(125050n);
    expect(fromMajor('1250').amount).toBe(125000n);
    expect(fromMajor('0.05').amount).toBe(5n);
  });

  it('rounds half-up when given more decimals than the currency allows', () => {
    expect(fromMajor('1.005').amount).toBe(101n);
    expect(fromMajor('1.004').amount).toBe(100n);
  });

  it('keeps the sign of negative amounts', () => {
    expect(fromMajor('-30.25').amount).toBe(-3025n);
  });

  it('accepts a number', () => {
    expect(fromMajor(4500).amount).toBe(450000n);
  });

  it('round-trips through toMajorNumber', () => {
    expect(toMajorNumber(fromMajor('3999.99'))).toBeCloseTo(3999.99, 2);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(add(money(1000n), money(250n)).amount).toBe(1250n);
    expect(subtract(money(1000n), money(250n)).amount).toBe(750n);
  });

  it('sums a list', () => {
    expect(sum([money(100n), money(200n), money(300n)]).amount).toBe(600n);
    expect(sum([]).amount).toBe(0n);
  });

  it('rejects mixing currencies', () => {
    expect(() => add(money(100n, 'DZD'), money(100n, 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => compare(money(1n, 'USD'), money(1n, 'EUR'))).toThrow(CurrencyMismatchError);
  });

  it('multiplies by an integer quantity without rounding', () => {
    expect(multiply(money(333n), 3n).amount).toBe(999n);
  });

  it('multiplies by a float and rounds half-up', () => {
    expect(multiply(money(101n), 0.5).amount).toBe(51n);
    expect(multiply(money(-101n), 0.5).amount).toBe(-51n);
  });

  it('negates and reports sign', () => {
    expect(negate(money(500n)).amount).toBe(-500n);
    expect(isNegative(money(-1n))).toBe(true);
    expect(isZero(zero())).toBe(true);
  });

  it('clamps negatives to zero', () => {
    expect(clampToZero(money(-500n)).amount).toBe(0n);
    expect(clampToZero(money(500n)).amount).toBe(500n);
  });

  it('orders values', () => {
    expect(compare(money(1n), money(2n))).toBe(-1);
    expect(compare(money(2n), money(1n))).toBe(1);
    expect(compare(money(2n), money(2n))).toBe(0);
    expect(max(money(1n), money(2n)).amount).toBe(2n);
    expect(min(money(1n), money(2n)).amount).toBe(1n);
  });
});

describe('percentOf', () => {
  it('computes a discount', () => {
    expect(percentOf(money(300000n), 30).amount).toBe(90000n);
  });

  it('rounds half-up on a tie', () => {
    expect(percentOf(money(101n), 50).amount).toBe(51n);
  });

  it('returns zero for a zero percentage', () => {
    expect(percentOf(money(300000n), 0).amount).toBe(0n);
  });
});

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    const parts = allocate(money(900n), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([300n, 300n, 300n]);
  });

  it('never loses a centime', () => {
    const parts = allocate(money(1000n), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([334n, 333n, 333n]);
    expect(sum(parts).amount).toBe(1000n);
  });

  it('respects weights', () => {
    const parts = allocate(money(10000n), [3000, 7000]);
    expect(parts.map((p) => p.amount)).toEqual([3000n, 7000n]);
  });

  it('re-sums exactly for awkward weights', () => {
    const parts = allocate(money(9999n), [1234, 5678, 91]);
    expect(sum(parts).amount).toBe(9999n);
  });

  it('handles a negative total, as when reversing a discount', () => {
    const parts = allocate(money(-1000n), [1, 1, 1]);
    expect(sum(parts).amount).toBe(-1000n);
  });

  it('rejects an empty or non-positive weight set', () => {
    expect(() => allocate(money(100n), [])).toThrow();
    expect(() => allocate(money(100n), [0, 0])).toThrow();
  });
});

describe('margin and discount', () => {
  it('computes margin as a percentage of the price', () => {
    expect(marginPercent(money(400000n), money(150000n))).toBe(62.5);
  });

  it('returns null when the price is zero', () => {
    expect(marginPercent(zero(), zero())).toBeNull();
  });

  it('reports a negative margin when the cost exceeds the price', () => {
    expect(marginPercent(money(1000n), money(1500n))).toBe(-50);
  });

  it('computes the discount badge percentage', () => {
    expect(discountPercent(money(500000n), money(350000n))).toBe(30);
  });

  it('reports no discount when compare-at is not higher', () => {
    expect(discountPercent(money(350000n), money(350000n))).toBe(0);
    expect(discountPercent(zero(), zero())).toBe(0);
  });
});

describe('taxIncluded', () => {
  it('extracts 19 % VAT from a tax-inclusive price', () => {
    // 5000.00 DA gross at 19 % -> net 4201.68, VAT 798.32
    expect(taxIncluded(money(500000n), 19).amount).toBe(79832n);
  });

  it('returns zero at a zero rate', () => {
    expect(taxIncluded(money(500000n), 0).amount).toBe(0n);
  });
});

describe('format', () => {
  it('puts the DA symbol after the number', () => {
    expect(format(money(350000n))).toMatch(/DA$/);
  });

  it('can drop the symbol', () => {
    expect(format(money(350000n), { withSymbol: false })).not.toMatch(/DA/);
  });

  it('puts the euro symbol before the number', () => {
    expect(format(money(1050n, 'EUR'), { locale: 'fr-FR' })).toMatch(/^€/);
  });

  it('supports compact notation for dashboard tiles', () => {
    expect(format(money(120000000n), { compact: true })).toBeTypeOf('string');
  });
});
