import { describe, expect, it } from 'vitest';
import {
  addPnl,
  allocateByRevenue,
  changePercent,
  computePnl,
  costPerOrder,
  emptyPnl,
  shareOf,
  roas,
  type PnlInput,
} from './pnl.js';

/** A month that traded: 1 200 000 DA of caps, sold at roughly a 55 % gross margin. */
const month: PnlInput = {
  revenueMinor: 120_000_000n,
  cogsMinor: 54_000_000n,
  shippingRevenueMinor: 8_000_000n,
  shippingCostMinor: 6_000_000n,
  discountsMinor: 4_000_000n,
  paymentFeesMinor: 1_200_000n,
  refundsMinor: 2_000_000n,
  expensesMinor: 30_000_000n,
  adSpendMinor: 15_000_000n,
};

describe('computePnl', () => {
  it('takes cost of goods off revenue for gross profit', () => {
    expect(computePnl(month).grossProfitMinor).toBe(66_000_000n);
  });

  it('reports the delivery margin separately', () => {
    expect(computePnl(month).shippingMarginMinor).toBe(2_000_000n);
  });

  it('shows a negative delivery margin rather than hiding it', () => {
    const subsidised = computePnl({ ...month, shippingRevenueMinor: 0n });
    expect(subsidised.shippingMarginMinor).toBe(-6_000_000n);
  });

  it('adds trading and delivery into contribution', () => {
    expect(computePnl(month).contributionMinor).toBe(68_000_000n);
  });

  it('subtracts fees, refunds, expenses and ads for net profit', () => {
    // 68 000 000 − 1 200 000 − 2 000 000 − 30 000 000 − 15 000 000.
    expect(computePnl(month).netProfitMinor).toBe(19_800_000n);
  });

  it('does not subtract discounts twice', () => {
    // Revenue is already net of them, so doubling the discount must not move net profit.
    const doubled = computePnl({ ...month, discountsMinor: 8_000_000n });
    expect(doubled.netProfitMinor).toBe(computePnl(month).netProfitMinor);
  });

  it('reports margins as percentages with one decimal', () => {
    const result = computePnl(month);
    expect(result.grossMarginPercent).toBe(55);
    expect(result.netMarginPercent).toBe(16.5);
  });

  it('handles a period with no sales without dividing by zero', () => {
    const result = computePnl({ ...emptyPnl(), expensesMinor: 30_000_000n });
    expect(result.netProfitMinor).toBe(-30_000_000n);
    expect(result.grossMarginPercent).toBe(0);
  });

  it('reports a loss as a negative number rather than clamping it', () => {
    const result = computePnl({ ...month, adSpendMinor: 90_000_000n });
    expect(result.netProfitMinor).toBeLessThan(0n);
  });

  it('carries every input through to the result', () => {
    const result = computePnl(month);
    expect(result.discountsMinor).toBe(month.discountsMinor);
    expect(result.adSpendMinor).toBe(month.adSpendMinor);
  });
});

describe('percentOf', () => {
  it('keeps one decimal place', () => {
    expect(shareOf(1n, 3n)).toBe(33.3);
  });

  it('is zero against a zero base', () => {
    expect(shareOf(500n, 0n)).toBe(0);
  });

  it('handles a negative part', () => {
    expect(shareOf(-50n, 100n)).toBe(-50);
  });
});

describe('addPnl', () => {
  it('adds every line', () => {
    const total = addPnl(month, month);
    expect(total.revenueMinor).toBe(240_000_000n);
    expect(total.adSpendMinor).toBe(30_000_000n);
  });

  it('leaves a value unchanged when added to nothing', () => {
    expect(addPnl(month, emptyPnl())).toEqual(month);
  });
});

describe('allocateByRevenue', () => {
  it('splits in proportion to revenue', () => {
    const allocation = allocateByRevenue(100_000n, [
      { key: 'alger', revenueMinor: 75_000_000n },
      { key: 'oran', revenueMinor: 25_000_000n },
    ]);
    expect(allocation.get('alger')).toBe(75_000n);
    expect(allocation.get('oran')).toBe(25_000n);
  });

  it('always adds back to the whole, remainder included', () => {
    const allocation = allocateByRevenue(100n, [
      { key: 'a', revenueMinor: 1n },
      { key: 'b', revenueMinor: 1n },
      { key: 'c', revenueMinor: 1n },
    ]);
    const total = [...allocation.values()].reduce((sum, value) => sum + value, 0n);
    expect(total).toBe(100n);
  });

  it('gives the rounding remainder to the largest group', () => {
    const allocation = allocateByRevenue(10n, [
      { key: 'big', revenueMinor: 2n },
      { key: 'small', revenueMinor: 1n },
    ]);
    expect(allocation.get('big')).toBe(7n);
    expect(allocation.get('small')).toBe(3n);
  });

  it('splits evenly when nothing sold, rather than dropping the cost', () => {
    const allocation = allocateByRevenue(10n, [
      { key: 'a', revenueMinor: 0n },
      { key: 'b', revenueMinor: 0n },
      { key: 'c', revenueMinor: 0n },
    ]);
    const total = [...allocation.values()].reduce((sum, value) => sum + value, 0n);
    expect(total).toBe(10n);
  });

  it('returns nothing for no groups', () => {
    expect(allocateByRevenue(1000n, []).size).toBe(0);
  });
});

describe('changePercent', () => {
  it('reports a rise', () => {
    expect(changePercent(150n, 100n)).toBe(50);
  });

  it('reports a fall', () => {
    expect(changePercent(80n, 100n)).toBe(-20);
  });

  it('says nothing rather than infinity against a zero base', () => {
    expect(changePercent(100n, 0n)).toBeNull();
  });

  it('handles a previous loss without flipping the sign', () => {
    // From −100 to −50 is an improvement of 50 %.
    expect(changePercent(-50n, -100n)).toBe(50);
  });
});

describe('roas and cost per order', () => {
  it('reports revenue earned per dinar spent', () => {
    expect(roas(120_000_000n, 15_000_000n)).toBe(8);
  });

  it('says nothing when nothing was spent', () => {
    expect(roas(120_000_000n, 0n)).toBeNull();
  });

  it('divides ad spend across orders', () => {
    expect(costPerOrder(15_000_000n, 300)).toBe(50_000n);
  });

  it('says nothing for a period with no orders', () => {
    expect(costPerOrder(15_000_000n, 0)).toBeNull();
  });

  it('says nothing when no advertising ran', () => {
    expect(costPerOrder(0n, 300)).toBeNull();
  });
});
