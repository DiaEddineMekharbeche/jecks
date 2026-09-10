import { describe, expect, it } from 'vitest';
import {
  buildSettlement,
  cashOutstanding,
  cashVariance,
  codFee,
  roundHalfUp,
  settlementDifference,
  toBasisPoints,
} from './settlement.js';

describe('roundHalfUp', () => {
  it('rounds an exact half away from zero', () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n);
    expect(roundHalfUp(-5n, 2n)).toBe(-3n);
  });

  it('rounds down below the half', () => {
    expect(roundHalfUp(4n, 3n)).toBe(1n);
  });

  it('divides exactly when it can', () => {
    expect(roundHalfUp(100n, 4n)).toBe(25n);
  });

  it('handles a negative denominator', () => {
    expect(roundHalfUp(5n, -2n)).toBe(-3n);
  });

  it('refuses to divide by zero', () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow('Cannot divide by zero');
  });
});

describe('toBasisPoints', () => {
  it('scales whole percentages', () => {
    expect(toBasisPoints(2)).toBe(200n);
  });

  it('keeps two decimal places', () => {
    expect(toBasisPoints('1.75')).toBe(175n);
    expect(toBasisPoints(1.75)).toBe(175n);
  });

  it('pads a single decimal place', () => {
    expect(toBasisPoints('1.5')).toBe(150n);
  });

  it('treats zero as zero', () => {
    expect(toBasisPoints('0')).toBe(0n);
    expect(toBasisPoints(0)).toBe(0n);
  });

  it('does not drift on a value floating point cannot hold', () => {
    // 0.1 + 0.2 territory: the string path must stay exact.
    expect(toBasisPoints('0.07')).toBe(7n);
  });
});

describe('codFee', () => {
  it('is zero when the courier takes no commission', () => {
    expect(codFee(500_000n, 0)).toBe(0n);
  });

  it('is zero on a zero collection', () => {
    expect(codFee(0n, 2)).toBe(0n);
  });

  it('takes the stated percentage', () => {
    // 2 % of 4 000,00 DA = 80,00 DA.
    expect(codFee(400_000n, 2)).toBe(8_000n);
  });

  it('rounds a fractional centime half-up', () => {
    // 1 % of 1 235 centimes = 12.35 → 12.
    expect(codFee(1_235n, 1)).toBe(12n);
    // 1 % of 1 250 centimes = 12.5 → 13.
    expect(codFee(1_250n, 1)).toBe(13n);
  });

  it('handles a fractional percentage', () => {
    expect(codFee(1_000_000n, '1.75')).toBe(17_500n);
  });
});

describe('buildSettlement', () => {
  const candidates = [
    { orderId: 'a', codAmountMinor: 450_000n, shippingCostMinor: 35_000n },
    { orderId: 'b', codAmountMinor: 620_000n, shippingCostMinor: 35_000n },
    { orderId: 'c', codAmountMinor: 0n, shippingCostMinor: 35_000n },
  ];

  it('adds the delivery fee and the commission on every line', () => {
    const settlement = buildSettlement(candidates, 2);
    expect(settlement.lines[0]).toEqual({
      orderId: 'a',
      codAmountMinor: 450_000n,
      feeAmountMinor: 35_000n + 9_000n,
      netAmountMinor: 450_000n - 44_000n,
    });
  });

  it('still charges the delivery fee on a parcel that collected nothing', () => {
    const settlement = buildSettlement(candidates, 2);
    const line = settlement.lines.find((entry) => entry.orderId === 'c')!;
    expect(line.feeAmountMinor).toBe(35_000n);
    expect(line.netAmountMinor).toBe(-35_000n);
  });

  it('totals gross, fees and net consistently', () => {
    const settlement = buildSettlement(candidates, 2);
    expect(settlement.grossMinor).toBe(1_070_000n);
    expect(settlement.netMinor).toBe(settlement.grossMinor - settlement.feesMinor);
  });

  it('is empty for no candidates', () => {
    const settlement = buildSettlement([], 2);
    expect(settlement.lines).toEqual([]);
    expect(settlement.grossMinor).toBe(0n);
    expect(settlement.netMinor).toBe(0n);
  });

  it('charges only the delivery fee at a zero commission', () => {
    const settlement = buildSettlement(candidates, 0);
    expect(settlement.feesMinor).toBe(105_000n);
  });
});

describe('settlementDifference', () => {
  it('is what the courier still owes', () => {
    expect(settlementDifference(1_000_000n, 400_000n)).toBe(600_000n);
  });

  it('is zero once paid in full', () => {
    expect(settlementDifference(1_000_000n, 1_000_000n)).toBe(0n);
  });

  it('goes negative on an overpayment rather than hiding it', () => {
    expect(settlementDifference(1_000_000n, 1_200_000n)).toBe(-200_000n);
  });
});

describe('cash positions', () => {
  it('reports what has been collected but not counted in', () => {
    expect(
      cashOutstanding({ expectedMinor: 900_000n, collectedMinor: 800_000n, reconciledMinor: 500_000n }),
    ).toBe(300_000n);
  });

  it('never reports negative outstanding cash', () => {
    expect(
      cashOutstanding({ expectedMinor: 0n, collectedMinor: 100_000n, reconciledMinor: 150_000n }),
    ).toBe(0n);
  });

  it('separates a shortfall against expectation from cash in hand', () => {
    const position = { expectedMinor: 900_000n, collectedMinor: 800_000n, reconciledMinor: 800_000n };
    expect(cashVariance(position)).toBe(-100_000n);
    expect(cashOutstanding(position)).toBe(0n);
  });

  it('shows an overcollection as a positive variance', () => {
    expect(
      cashVariance({ expectedMinor: 500_000n, collectedMinor: 520_000n, reconciledMinor: 0n }),
    ).toBe(20_000n);
  });
});
