import { describe, expect, it } from 'vitest';
import { applyRate, rateMargin, selectRate, type RateCandidate } from './rates.js';

const base: RateCandidate = {
  id: 'r1',
  wilayaCode: null,
  zoneId: 'z1',
  courierId: null,
  courierActive: true,
  priceMinor: 50_000n,
  costMinor: 35_000n,
  freeWeightGrams: 1000,
  extraPerKgMinor: 10_000n,
  freeShippingThresholdMinor: null,
  etaMinDays: 2,
  etaMaxDays: 4,
  active: true,
};

const rate = (overrides: Partial<RateCandidate>): RateCandidate => ({ ...base, ...overrides });

describe('selectRate', () => {
  it('returns null when nothing covers the wilaya', () => {
    expect(selectRate([])).toBeNull();
  });

  it('prefers a wilaya rate over a cheaper zone rate', () => {
    const chosen = selectRate([
      rate({ id: 'zone', priceMinor: 30_000n }),
      rate({ id: 'wilaya', wilayaCode: 16, zoneId: null, priceMinor: 40_000n }),
    ]);
    expect(chosen?.id).toBe('wilaya');
  });

  it('takes the cheapest among equally specific rates', () => {
    const chosen = selectRate([
      rate({ id: 'expensive', wilayaCode: 16, priceMinor: 60_000n }),
      rate({ id: 'cheap', wilayaCode: 16, priceMinor: 45_000n }),
    ]);
    expect(chosen?.id).toBe('cheap');
  });

  it('breaks a price tie on our own cost', () => {
    const chosen = selectRate([
      rate({ id: 'costly', wilayaCode: 16, costMinor: 40_000n }),
      rate({ id: 'lean', wilayaCode: 16, costMinor: 25_000n }),
    ]);
    expect(chosen?.id).toBe('lean');
  });

  it('ignores an inactive rate', () => {
    const chosen = selectRate([
      rate({ id: 'off', wilayaCode: 16, priceMinor: 10_000n, active: false }),
      rate({ id: 'on', wilayaCode: 16 }),
    ]);
    expect(chosen?.id).toBe('on');
  });

  it('ignores a rate whose courier is switched off', () => {
    const chosen = selectRate([
      rate({ id: 'dormant', wilayaCode: 16, courierId: 'c1', courierActive: false, priceMinor: 10_000n }),
      rate({ id: 'live', wilayaCode: 16, courierId: 'c2', courierActive: true }),
    ]);
    expect(chosen?.id).toBe('live');
  });

  it('falls back to the zone when every wilaya rate is unusable', () => {
    const chosen = selectRate([
      rate({ id: 'broken', wilayaCode: 16, active: false }),
      rate({ id: 'zone' }),
    ]);
    expect(chosen?.id).toBe('zone');
  });

  it('is deterministic when two rates are identical', () => {
    const first = selectRate([rate({ id: 'b' }), rate({ id: 'a' })]);
    const second = selectRate([rate({ id: 'a' }), rate({ id: 'b' })]);
    expect(first?.id).toBe(second?.id);
  });
});

describe('applyRate', () => {
  it('charges the plain price inside the weight allowance', () => {
    const applied = applyRate(base, { weightGrams: 800 });
    expect(applied.priceMinor).toBe(50_000n);
    expect(applied.weightSurchargeMinor).toBe(0n);
  });

  it('bills a started kilo over the allowance', () => {
    // 1 800 g against a 1 000 g allowance is 800 g over, billed as one kilo.
    const applied = applyRate(base, { weightGrams: 1800 });
    expect(applied.weightSurchargeMinor).toBe(10_000n);
    expect(applied.priceMinor).toBe(60_000n);
  });

  it('bills each further kilo', () => {
    const applied = applyRate(base, { weightGrams: 3100 });
    expect(applied.weightSurchargeMinor).toBe(30_000n);
  });

  it('treats a missing weight as zero', () => {
    expect(applyRate(base, {}).priceMinor).toBe(50_000n);
  });

  it('ignores a negative weight rather than crediting it', () => {
    expect(applyRate(base, { weightGrams: -5000 }).priceMinor).toBe(50_000n);
  });

  it('makes delivery free above the threshold, surcharge included', () => {
    const applied = applyRate(rate({ freeShippingThresholdMinor: 600_000n }), {
      weightGrams: 4000,
      subtotalMinor: 700_000n,
    });
    expect(applied.freeShippingApplied).toBe(true);
    expect(applied.priceMinor).toBe(0n);
  });

  it('still charges just below the threshold', () => {
    const applied = applyRate(rate({ freeShippingThresholdMinor: 600_000n }), {
      subtotalMinor: 599_999n,
    });
    expect(applied.freeShippingApplied).toBe(false);
    expect(applied.priceMinor).toBe(50_000n);
  });

  it('keeps our cost whatever the shopper pays', () => {
    const applied = applyRate(rate({ freeShippingThresholdMinor: 0n }), { subtotalMinor: 1n });
    expect(applied.priceMinor).toBe(0n);
    expect(applied.costMinor).toBe(35_000n);
  });

  it('marks a zone rate as inherited', () => {
    expect(applyRate(base, {}).inherited).toBe(true);
    expect(applyRate(rate({ wilayaCode: 16 }), {}).inherited).toBe(false);
  });
});

describe('rateMargin', () => {
  it('is price less cost', () => {
    expect(rateMargin({ priceMinor: 50_000n, costMinor: 35_000n })).toBe(15_000n);
  });

  it('goes negative when delivery is subsidised', () => {
    expect(rateMargin({ priceMinor: 0n, costMinor: 35_000n })).toBe(-35_000n);
  });
});
