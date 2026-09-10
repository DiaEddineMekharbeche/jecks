import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOYALTY_POLICY,
  applyMovement,
  balanceValue,
  expiresAt,
  pointsForOrder,
  redeem,
} from './loyalty.js';
import {
  averageDaysBetweenOrders,
  averageOrderValue,
  deliveryReliability,
  isOverdue,
  segmentOf,
} from './segments.js';

// --- loyalty ----------------------------------------------------------------

describe('pointsForOrder', () => {
  it('earns one point per dinar of goods', () => {
    expect(pointsForOrder({ itemsSubtotalMinor: 450_000n, discountMinor: 0n })).toBe(4500);
  });

  it('earns on what was actually charged, not the list price', () => {
    expect(pointsForOrder({ itemsSubtotalMinor: 450_000n, discountMinor: 50_000n })).toBe(4000);
  });

  it('ignores delivery, which is not margin', () => {
    // Only the items subtotal is passed in; a bigger order total cannot change this.
    expect(pointsForOrder({ itemsSubtotalMinor: 100_000n, discountMinor: 0n })).toBe(1000);
  });

  it('drops the fraction of a point rather than rounding up', () => {
    expect(pointsForOrder({ itemsSubtotalMinor: 199n, discountMinor: 0n })).toBe(1);
  });

  it('earns nothing on an order discounted to nothing', () => {
    expect(pointsForOrder({ itemsSubtotalMinor: 100_000n, discountMinor: 100_000n })).toBe(0);
  });

  it('earns nothing when the rate is zero', () => {
    expect(
      pointsForOrder(
        { itemsSubtotalMinor: 450_000n, discountMinor: 0n },
        { ...DEFAULT_LOYALTY_POLICY, pointsPerDinar: 0 },
      ),
    ).toBe(0);
  });

  it('respects a richer earn rate', () => {
    expect(
      pointsForOrder(
        { itemsSubtotalMinor: 450_000n, discountMinor: 0n },
        { ...DEFAULT_LOYALTY_POLICY, pointsPerDinar: 2 },
      ),
    ).toBe(9000);
  });
});

describe('redeem', () => {
  it('turns points into a discount at the configured rate', () => {
    const result = redeem({ points: 1000, balance: 5000, payableMinor: 1_000_000n });
    expect(result.points).toBe(1000);
    expect(result.discountMinor).toBe(100_000n);
    expect(result.reason).toBe('ok');
  });

  it('refuses a redemption below the minimum', () => {
    const result = redeem({ points: 50, balance: 5000, payableMinor: 1_000_000n });
    expect(result.points).toBe(0);
    expect(result.reason).toBe('BELOW_MINIMUM');
  });

  it('spends no more than the balance', () => {
    const result = redeem({ points: 5000, balance: 1200, payableMinor: 1_000_000n });
    expect(result.points).toBe(1200);
    expect(result.reason).toBe('INSUFFICIENT_BALANCE');
  });

  it('refuses when even the whole balance is under the minimum', () => {
    const result = redeem({ points: 500, balance: 40, payableMinor: 1_000_000n });
    expect(result.points).toBe(0);
    expect(result.reason).toBe('INSUFFICIENT_BALANCE');
  });

  it('caps the discount at the order share limit', () => {
    // 50 % of 100 000 centimes is 50 000, which is 500 points.
    const result = redeem({ points: 5000, balance: 5000, payableMinor: 100_000n });
    expect(result.discountMinor).toBe(50_000n);
    expect(result.points).toBe(500);
    expect(result.reason).toBe('CAPPED_BY_ORDER');
  });

  it('never spends points that buy nothing', () => {
    const result = redeem({ points: 5000, balance: 5000, payableMinor: 100_000n });
    expect(result.discountMinor).toBe(
      BigInt(result.points) * BigInt(DEFAULT_LOYALTY_POLICY.dinarsPerPoint * 100),
    );
  });

  it('refuses when the cap leaves less than the minimum', () => {
    const result = redeem({ points: 5000, balance: 5000, payableMinor: 10_000n });
    expect(result.points).toBe(0);
    expect(result.reason).toBe('CAPPED_BY_ORDER');
  });

  it('refuses against an order with nothing left to pay', () => {
    expect(redeem({ points: 1000, balance: 5000, payableMinor: 0n }).reason).toBe('NOTHING_TO_PAY');
  });

  it('ignores a negative request', () => {
    expect(redeem({ points: -100, balance: 5000, payableMinor: 100_000n }).points).toBe(0);
  });

  it('honours a more generous share limit', () => {
    const result = redeem(
      { points: 1000, balance: 5000, payableMinor: 100_000n },
      { ...DEFAULT_LOYALTY_POLICY, maxRedemptionPercent: 100 },
    );
    expect(result.discountMinor).toBe(100_000n);
  });
});

describe('balance helpers', () => {
  it('values a balance at the redemption rate', () => {
    expect(balanceValue(1200)).toBe(120_000n);
  });

  it('values nothing at nothing', () => {
    expect(balanceValue(0)).toBe(0n);
    expect(balanceValue(-50)).toBe(0n);
  });

  it('never lets a balance go negative', () => {
    expect(applyMovement(100, -500)).toBe(0);
    expect(applyMovement(100, 50)).toBe(150);
  });

  it('dates expiry from the last activity', () => {
    const expiry = expiresAt(new Date('2026-01-01T00:00:00Z'));
    expect(expiry?.toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  it('never expires when expiry is switched off', () => {
    expect(expiresAt(new Date(), { ...DEFAULT_LOYALTY_POLICY, expiryDays: 0 })).toBeNull();
  });
});

// --- segments ---------------------------------------------------------------

const now = new Date('2026-09-11T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('segmentOf', () => {
  it('puts a blacklisted customer above every other rule', () => {
    expect(
      segmentOf(
        {
          blacklisted: true,
          deliveredCount: 20,
          lifetimeValueMinor: 90_000_000n,
          lastOrderAt: daysAgo(1),
        },
        now,
      ),
    ).toBe('BLACKLISTED');
  });

  it('calls someone with nothing delivered new, however long ago they ordered', () => {
    expect(
      segmentOf(
        { blacklisted: false, deliveredCount: 0, lifetimeValueMinor: 0n, lastOrderAt: daysAgo(400) },
        now,
      ),
    ).toBe('NEW');
  });

  it('calls a silent customer at risk whatever they used to spend', () => {
    expect(
      segmentOf(
        {
          blacklisted: false,
          deliveredCount: 10,
          lifetimeValueMinor: 90_000_000n,
          lastOrderAt: daysAgo(120),
        },
        now,
      ),
    ).toBe('AT_RISK');
  });

  it('needs both value and repetition for VIP', () => {
    const oneBigOrder = segmentOf(
      {
        blacklisted: false,
        deliveredCount: 1,
        lifetimeValueMinor: 90_000_000n,
        lastOrderAt: daysAgo(5),
      },
      now,
    );
    expect(oneBigOrder).toBe('NEW');

    const both = segmentOf(
      {
        blacklisted: false,
        deliveredCount: 4,
        lifetimeValueMinor: 90_000_000n,
        lastOrderAt: daysAgo(5),
      },
      now,
    );
    expect(both).toBe('VIP');
  });

  it('calls a second delivered order returning', () => {
    expect(
      segmentOf(
        {
          blacklisted: false,
          deliveredCount: 2,
          lifetimeValueMinor: 400_000n,
          lastOrderAt: daysAgo(10),
        },
        now,
      ),
    ).toBe('RETURNING');
  });

  it('treats a delivered order with no date as silent', () => {
    expect(
      segmentOf(
        { blacklisted: false, deliveredCount: 3, lifetimeValueMinor: 0n, lastOrderAt: null },
        now,
      ),
    ).toBe('AT_RISK');
  });
});

describe('customer metrics', () => {
  it('measures reliability over attempts, not over orders placed', () => {
    expect(deliveryReliability({ deliveredCount: 8, failedCount: 2 })).toBe(80);
  });

  it('says nothing about a customer nobody has tried to deliver to', () => {
    expect(deliveryReliability({ deliveredCount: 0, failedCount: 0 })).toBeNull();
  });

  it('averages order value over delivered orders only', () => {
    expect(averageOrderValue({ deliveredCount: 4, lifetimeValueMinor: 4_000_000n })).toBe(
      1_000_000n,
    );
  });

  it('averages nothing over nothing', () => {
    expect(averageOrderValue({ deliveredCount: 0, lifetimeValueMinor: 500n })).toBe(0n);
  });

  it('finds the rhythm between orders', () => {
    expect(
      averageDaysBetweenOrders([daysAgo(90), daysAgo(60), daysAgo(30)]),
    ).toBe(30);
  });

  it('refuses to invent a rhythm from one order', () => {
    expect(averageDaysBetweenOrders([daysAgo(30)])).toBeNull();
    expect(averageDaysBetweenOrders([])).toBeNull();
  });

  it('flags a customer half again past their own rhythm', () => {
    expect(isOverdue(daysAgo(50), 30, now)).toBe(true);
    expect(isOverdue(daysAgo(40), 30, now)).toBe(false);
  });

  it('flags nobody without a rhythm to compare against', () => {
    expect(isOverdue(daysAgo(400), null, now)).toBe(false);
    expect(isOverdue(null, 30, now)).toBe(false);
  });
});
