import { describe, expect, it } from 'vitest';
import { advance, occurrencesBetween } from './recurrence.js';

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);
const days = (dates: Date[]) => dates.map((date) => date.toISOString().slice(0, 10));

describe('advance', () => {
  it('steps forward a week at a time', () => {
    expect(advance(utc('2026-01-01'), 'weekly', 3).toISOString().slice(0, 10)).toBe('2026-01-22');
  });

  it('steps forward a month at a time', () => {
    expect(advance(utc('2026-01-15'), 'monthly', 2).toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('steps forward a year at a time', () => {
    expect(advance(utc('2026-03-01'), 'yearly', 2).toISOString().slice(0, 10)).toBe('2028-03-01');
  });

  it('clamps the 31st to the last day of a shorter month', () => {
    // The rent is still due in February; it must not skip or spill into March.
    expect(advance(utc('2026-01-31'), 'monthly', 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(advance(utc('2026-01-31'), 'monthly', 3).toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('returns to the original day after a short month', () => {
    // Clamping February must not drag March back to the 28th.
    expect(advance(utc('2026-01-31'), 'monthly', 2).toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('handles a leap February', () => {
    expect(advance(utc('2028-01-31'), 'monthly', 1).toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('crosses a year boundary', () => {
    expect(advance(utc('2026-11-15'), 'monthly', 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });
});

describe('occurrencesBetween', () => {
  it('includes the start date', () => {
    const dates = occurrencesBetween(utc('2026-01-01'), 'monthly', utc('2026-01-01'));
    expect(days(dates)).toEqual(['2026-01-01']);
  });

  it('lists every month up to the cut-off', () => {
    const dates = occurrencesBetween(utc('2026-01-15'), 'monthly', utc('2026-04-20'));
    expect(days(dates)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('stops at the end of the series when that comes first', () => {
    const dates = occurrencesBetween(
      utc('2026-01-15'),
      'monthly',
      utc('2026-12-31'),
      utc('2026-03-01'),
    );
    expect(days(dates)).toEqual(['2026-01-15', '2026-02-15']);
  });

  it('returns nothing when the cut-off is before the start', () => {
    expect(occurrencesBetween(utc('2026-06-01'), 'monthly', utc('2026-01-01'))).toEqual([]);
  });

  it('lists weeks', () => {
    const dates = occurrencesBetween(utc('2026-01-01'), 'weekly', utc('2026-01-22'));
    expect(days(dates)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22']);
  });

  it('lists years', () => {
    const dates = occurrencesBetween(utc('2024-05-01'), 'yearly', utc('2026-06-01'));
    expect(days(dates)).toEqual(['2024-05-01', '2025-05-01', '2026-05-01']);
  });

  it('is bounded, so a corrupt row cannot spin forever', () => {
    const dates = occurrencesBetween(utc('1900-01-01'), 'weekly', utc('2100-01-01'));
    expect(dates).toHaveLength(600);
  });
});
