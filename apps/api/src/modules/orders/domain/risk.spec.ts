import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_POLICY, assessRisk, looksVague, type RiskSignals } from './risk.js';

/**
 * COD risk scoring — PRD F-AD-31, F-ST-44.
 *
 * The score exists to put an order in front of a human, not to refuse it. So what is
 * tested here is as much what it does *not* do — block a real customer, demand a
 * captcha from someone with a bad delivery history — as what it flags.
 */

function signals(overrides: Partial<RiskSignals> = {}): RiskSignals {
  return {
    deliveredCount: 4,
    failedCount: 0,
    cancelledCount: 0,
    ordersToday: 1,
    duplicateWithinWindow: false,
    blacklisted: false,
    ordersFromIpLastHour: 1,
    totalMinor: 500_000n,
    averageOrderMinor: 450_000n,
    phoneUnverified: false,
    addressSuspicious: false,
    ...overrides,
  };
}

describe('a good customer', () => {
  it('scores zero and is never blocked', () => {
    const result = assessRisk(signals());
    expect(result).toMatchObject({ score: 0, block: false, requireCaptcha: false });
    expect(result.flags).toEqual([]);
  });

  it('stays below the review threshold with one old failure behind them', () => {
    // One failure in thirty deliveries is a bad week, not a habit.
    const result = assessRisk(signals({ deliveredCount: 29, failedCount: 1 }));
    expect(result.score).toBeLessThan(DEFAULT_RISK_POLICY.reviewThreshold);
    expect(result.block).toBe(false);
  });
});

describe('the blacklist', () => {
  it('blocks outright, whatever else is true', () => {
    const result = assessRisk(signals({ blacklisted: true, deliveredCount: 50 }));
    expect(result).toMatchObject({ score: 100, block: true });
    expect(result.flags).toEqual(['BLACKLISTED']);
  });

  it('does not ask for a captcha: the answer is no, not "prove you are human"', () => {
    expect(assessRisk(signals({ blacklisted: true })).requireCaptcha).toBe(false);
  });
});

describe('delivery history', () => {
  it('weighs failures against attempts rather than counting them flat', () => {
    const habitual = assessRisk(signals({ deliveredCount: 0, failedCount: 3 }));
    const occasional = assessRisk(signals({ deliveredCount: 40, failedCount: 3 }));

    expect(habitual.score).toBeGreaterThan(occasional.score);
    expect(habitual.flags).toContain('FAILED_HISTORY');
  });

  it('flags a first order that already failed once', () => {
    const result = assessRisk(signals({ deliveredCount: 0, failedCount: 1 }));
    expect(result.flags).toContain('FAILED_HISTORY');
  });

  it('flags a customer who cancels repeatedly', () => {
    expect(assessRisk(signals({ cancelledCount: 4 })).flags).toContain('MANY_CANCELLATIONS');
  });

  it('never demands a captcha because of a bad history: that is a person, not a bot', () => {
    const result = assessRisk(signals({ deliveredCount: 0, failedCount: 4, cancelledCount: 5 }));
    expect(result.requireCaptcha).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(DEFAULT_RISK_POLICY.reviewThreshold);
  });
});

describe('automation patterns', () => {
  it('flags and challenges a phone placing too many orders in a day', () => {
    const result = assessRisk(signals({ ordersToday: 3 }));
    expect(result.flags).toContain('ORDER_FLOOD');
    expect(result.requireCaptcha).toBe(true);
  });

  it('flags and challenges an IP placing too many orders in an hour', () => {
    const result = assessRisk(signals({ ordersFromIpLastHour: 9 }));
    expect(result.flags).toContain('IP_FLOOD');
    expect(result.requireCaptcha).toBe(true);
  });

  it('honours a shop that raised its own limits', () => {
    const result = assessRisk(signals({ ordersToday: 5 }), {
      ...DEFAULT_RISK_POLICY,
      maxOrdersPerPhonePerDay: 10,
    });
    expect(result.flags).not.toContain('ORDER_FLOOD');
  });

  it('flags a duplicate inside the window without blocking it', () => {
    const result = assessRisk(signals({ duplicateWithinWindow: true }));
    expect(result.flags).toContain('DUPLICATE_ORDER');
    expect(result.block).toBe(false);
  });
});

describe('order shape', () => {
  it('flags an unusually large first order', () => {
    const result = assessRisk(
      signals({ deliveredCount: 0, failedCount: 0, totalMinor: 3_000_000n, averageOrderMinor: 450_000n }),
    );
    expect(result.flags).toContain('UNUSUALLY_LARGE');
  });

  it('does not flag a large order from a repeat customer', () => {
    const result = assessRisk(signals({ deliveredCount: 8, totalMinor: 3_000_000n }));
    expect(result.flags).not.toContain('UNUSUALLY_LARGE');
  });

  it('says nothing about size when the shop has no history to compare against', () => {
    const result = assessRisk(
      signals({ deliveredCount: 0, totalMinor: 9_000_000n, averageOrderMinor: 0n }),
    );
    expect(result.flags).not.toContain('UNUSUALLY_LARGE');
  });

  it('flags an unverified phone and a vague address', () => {
    const result = assessRisk(signals({ phoneUnverified: true, addressSuspicious: true }));
    expect(result.flags).toEqual(expect.arrayContaining(['PHONE_UNVERIFIED', 'VAGUE_ADDRESS']));
  });

  it('notes a first order so the other flags are read in context', () => {
    expect(assessRisk(signals({ deliveredCount: 0, failedCount: 0 })).flags).toContain('FIRST_ORDER');
  });
});

describe('the score itself', () => {
  it('never exceeds 100', () => {
    const result = assessRisk(
      signals({
        deliveredCount: 0,
        failedCount: 5,
        cancelledCount: 9,
        ordersToday: 9,
        ordersFromIpLastHour: 40,
        duplicateWithinWindow: true,
        phoneUnverified: true,
        addressSuspicious: true,
        totalMinor: 9_000_000n,
      }),
    );
    expect(result.score).toBe(100);
    // Still not a block: only a human, or the blacklist, refuses an order.
    expect(result.block).toBe(false);
  });
});

describe('looksVague', () => {
  it('accepts a real Algerian address', () => {
    expect(looksVague('Cité 1200 Logements, Bât C, Bab Ezzouar')).toBe(false);
    expect(looksVague('En face de la mosquée El Nour, Draria')).toBe(false);
  });

  it('rejects an empty or absent one', () => {
    expect(looksVague('')).toBe(true);
    expect(looksVague(null)).toBe(true);
    expect(looksVague(undefined)).toBe(true);
    expect(looksVague('   ')).toBe(true);
  });

  it('rejects something too short to find a door with', () => {
    expect(looksVague('Alger')).toBe(true);
  });

  it('rejects a string with no letters in it', () => {
    expect(looksVague('123456789012')).toBe(true);
  });

  it('rejects the character someone repeats to get past a required field', () => {
    expect(looksVague('aaaaaaaaaaaaaa')).toBe(true);
  });
});
