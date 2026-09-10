import { describe, expect, it } from 'vitest';
import {
  allocateByValue,
  divideRoundHalfUp,
  landedUnitCost,
  purchaseOrderTotals,
  stockState,
  weightedAverageCost,
} from './costing.js';

describe('weightedAverageCost', () => {
  it('adopts the receipt cost when nothing is on hand', () => {
    expect(
      weightedAverageCost({ quantity: 0, unitCostMinor: 0n }, { quantity: 20, unitCostMinor: 90_000n }),
    ).toBe(90_000n);
  });

  /** The M1.3 definition of done, in numbers: 20 units at 900 DA. */
  it('averages a 900 DA receipt against stock held at 1000 DA', () => {
    // 10 units at 1000 DA + 20 units at 900 DA = 28 000 DA over 30 units.
    const next = weightedAverageCost(
      { quantity: 10, unitCostMinor: 100_000n },
      { quantity: 20, unitCostMinor: 90_000n },
    );
    expect(next).toBe(93_333n);
  });

  it('rounds the average half-up to the centime', () => {
    // (1 x 101 + 2 x 100) / 3 = 100.333 -> 100
    expect(
      weightedAverageCost({ quantity: 1, unitCostMinor: 101n }, { quantity: 2, unitCostMinor: 100n }),
    ).toBe(100n);
    // (1 x 100 + 1 x 101) / 2 = 100.5 -> 101
    expect(
      weightedAverageCost({ quantity: 1, unitCostMinor: 100n }, { quantity: 1, unitCostMinor: 101n }),
    ).toBe(101n);
  });

  it('leaves the cost untouched when nothing is received', () => {
    expect(
      weightedAverageCost({ quantity: 5, unitCostMinor: 50_000n }, { quantity: 0, unitCostMinor: 1n }),
    ).toBe(50_000n);
    expect(
      weightedAverageCost({ quantity: 5, unitCostMinor: 50_000n }, { quantity: -3, unitCostMinor: 1n }),
    ).toBe(50_000n);
  });

  it('ignores an oversold position rather than averaging against negative units', () => {
    expect(
      weightedAverageCost({ quantity: -4, unitCostMinor: 10n }, { quantity: 10, unitCostMinor: 80_000n }),
    ).toBe(80_000n);
  });

  it('folds freight into the cost per unit', () => {
    // 20 units at 900 DA plus 2000 DA freight = 1000 DA landed.
    expect(
      weightedAverageCost(
        { quantity: 0, unitCostMinor: 0n },
        { quantity: 20, unitCostMinor: 90_000n, landedExtraMinor: 200_000n },
      ),
    ).toBe(100_000n);
  });

  it('is stable when the same cost is received repeatedly', () => {
    let position = { quantity: 0, unitCostMinor: 0n };
    for (let index = 0; index < 25; index += 1) {
      position = {
        quantity: position.quantity + 7,
        unitCostMinor: weightedAverageCost(position, { quantity: 7, unitCostMinor: 123_456n }),
      };
    }
    expect(position.unitCostMinor).toBe(123_456n);
    expect(position.quantity).toBe(175);
  });
});

describe('landedUnitCost', () => {
  it('divides the extra across the received units', () => {
    expect(landedUnitCost({ quantity: 4, unitCostMinor: 1_000n, landedExtraMinor: 400n })).toBe(1_100n);
  });

  it('rounds the per-unit share half-up', () => {
    expect(landedUnitCost({ quantity: 3, unitCostMinor: 0n, landedExtraMinor: 100n })).toBe(33n);
    expect(landedUnitCost({ quantity: 3, unitCostMinor: 0n, landedExtraMinor: 101n })).toBe(34n);
  });

  it('returns the bare cost with no extra or no quantity', () => {
    expect(landedUnitCost({ quantity: 5, unitCostMinor: 900n })).toBe(900n);
    expect(landedUnitCost({ quantity: 0, unitCostMinor: 900n, landedExtraMinor: 500n })).toBe(900n);
  });
});

describe('allocateByValue', () => {
  it('splits in proportion to line value', () => {
    expect(allocateByValue(300n, [100n, 200n])).toEqual([100n, 200n]);
  });

  it('always sums back to the amount allocated', () => {
    const allocations = allocateByValue(1_000n, [333n, 333n, 334n]);
    expect(allocations.reduce((acc, value) => acc + value, 0n)).toBe(1_000n);
  });

  it('gives the rounding remainder to the largest line', () => {
    const allocations = allocateByValue(10n, [1n, 1n, 8n]);
    expect(allocations.reduce((acc, value) => acc + value, 0n)).toBe(10n);
    expect(allocations[2]).toBeGreaterThan(allocations[0]!);
  });

  it('splits evenly when every line is worthless', () => {
    expect(allocateByValue(10n, [0n, 0n, 0n])).toEqual([4n, 3n, 3n]);
  });

  it('handles the empty and zero cases', () => {
    expect(allocateByValue(500n, [])).toEqual([]);
    expect(allocateByValue(0n, [1n, 2n])).toEqual([0n, 0n]);
  });
});

describe('purchaseOrderTotals', () => {
  it('adds the lines then the order-level costs', () => {
    expect(
      purchaseOrderTotals({
        items: [
          { quantity: 20, unitCost: 90_000n },
          { quantity: 5, unitCost: 40_000n },
        ],
        shippingCost: 150_000n,
        otherCost: 50_000n,
      }),
    ).toEqual({ subtotal: 2_000_000n, total: 2_200_000n, quantity: 25 });
  });

  it('treats a negative quantity as zero rather than as a credit', () => {
    expect(
      purchaseOrderTotals({
        items: [{ quantity: -4, unitCost: 1_000n }],
        shippingCost: 0n,
        otherCost: 0n,
      }),
    ).toEqual({ subtotal: 0n, total: 0n, quantity: 0 });
  });
});

describe('divideRoundHalfUp', () => {
  it('rounds a half away from zero in both directions', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
  });

  it('refuses to divide by zero', () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(/denominator is zero/);
  });
});

describe('stockState', () => {
  it('classifies each bucket from available stock, not on-hand', () => {
    expect(stockState({ onHand: 10, reserved: 0 }, 5)).toBe('in');
    expect(stockState({ onHand: 10, reserved: 6 }, 5)).toBe('low');
    expect(stockState({ onHand: 10, reserved: 10 }, 5)).toBe('out');
    expect(stockState({ onHand: -2, reserved: 0 }, 5)).toBe('negative');
  });

  it('treats a level exactly on the threshold as low', () => {
    expect(stockState({ onHand: 5, reserved: 0 }, 5)).toBe('low');
    expect(stockState({ onHand: 6, reserved: 0 }, 5)).toBe('in');
  });
});
