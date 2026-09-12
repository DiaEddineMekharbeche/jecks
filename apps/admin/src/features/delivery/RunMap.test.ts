import { describe, expect, it } from 'vitest';
import { __runMapInternals, type RunStopPoint } from './RunMap';

const { layout, VIEW, PADDING } = __runMapInternals;

/**
 * The sketch of a delivery round.
 *
 * It fits itself to its own stops rather than to a fixed frame, because a round inside
 * one commune and a round across three wilayas both have to fill the drawing. That is
 * the part worth testing: a shared scale would render the first as a single dot, and
 * dividing by a zero span would render it as nothing at all.
 */

function stop(overrides: Partial<RunStopPoint> & { position: number }): RunStopPoint {
  return {
    id: `stop-${overrides.position}`,
    orderNumber: `JK-2609-000${overrides.position}`,
    latitude: 36.75,
    longitude: 3.05,
    status: 'PENDING',
    ...overrides,
  };
}

describe('layout', () => {
  it('drops a stop with no coordinates rather than placing it at zero', () => {
    // A stop at (0,0) is off the coast of Africa and would drag the whole extent.
    const placed = layout([
      stop({ position: 1, latitude: 36.75, longitude: 3.05 }),
      stop({ position: 2, latitude: null, longitude: null }),
    ]);

    expect(placed).toHaveLength(1);
    expect(placed[0]!.position).toBe(1);
  });

  it('orders the stops by position, not by the order they arrived in', () => {
    const placed = layout([
      stop({ position: 3, latitude: 36.8, longitude: 3.1 }),
      stop({ position: 1, latitude: 36.7, longitude: 3.0 }),
      stop({ position: 2, latitude: 36.75, longitude: 3.05 }),
    ]);

    // The line is drawn through them in order; unsorted it would zig-zag.
    expect(placed.map((entry) => entry.position)).toEqual([1, 2, 3]);
  });

  it('fills the frame for a round across a whole region', () => {
    const placed = layout([
      stop({ position: 1, latitude: 36.75, longitude: 3.05 }),
      stop({ position: 2, latitude: 35.69, longitude: -0.63 }),
    ]);

    const xs = placed.map((entry) => entry.x);
    expect(Math.min(...xs)).toBeCloseTo(PADDING, 0);
    expect(Math.max(...xs)).toBeCloseTo(VIEW.width - PADDING, 0);
  });

  it('fills the frame for a round inside one commune, too', () => {
    // Two streets apart. A fixed country-sized scale would put both on the same pixel.
    const placed = layout([
      stop({ position: 1, latitude: 36.7500, longitude: 3.0500 }),
      stop({ position: 2, latitude: 36.7530, longitude: 3.0560 }),
    ]);

    expect(placed[0]!.x).not.toBeCloseTo(placed[1]!.x, 0);
  });

  it('does not divide by zero when every stop shares a coordinate', () => {
    // The wilaya-centroid fallback (D74) makes this common: several stops in the same
    // wilaya all resolve to its chef-lieu.
    const placed = layout([
      stop({ position: 1, latitude: 36.75, longitude: 3.05 }),
      stop({ position: 2, latitude: 36.75, longitude: 3.05 }),
      stop({ position: 3, latitude: 36.75, longitude: 3.05 }),
    ]);

    for (const entry of placed) {
      expect(Number.isFinite(entry.x)).toBe(true);
      expect(Number.isFinite(entry.y)).toBe(true);
    }
  });

  it('keeps every stop inside the frame', () => {
    const placed = layout([
      stop({ position: 1, latitude: 36.9, longitude: 7.76 }),
      stop({ position: 2, latitude: 22.78, longitude: 5.52 }),
      stop({ position: 3, latitude: 27.67, longitude: -8.14 }),
    ]);

    for (const entry of placed) {
      expect(entry.x).toBeGreaterThanOrEqual(0);
      expect(entry.x).toBeLessThanOrEqual(VIEW.width);
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeLessThanOrEqual(VIEW.height);
    }
  });

  it('puts the northern stop above the southern one', () => {
    const placed = layout([
      stop({ position: 1, latitude: 36.75, longitude: 3.05 }),
      stop({ position: 2, latitude: 22.78, longitude: 5.52 }),
    ]);

    expect(placed[0]!.y).toBeLessThan(placed[1]!.y);
  });

  it('returns nothing for a round with no located stops', () => {
    expect(layout([])).toEqual([]);
    expect(layout([stop({ position: 1, latitude: null, longitude: null })])).toEqual([]);
  });
});
