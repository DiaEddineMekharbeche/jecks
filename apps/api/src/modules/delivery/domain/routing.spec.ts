import { describe, expect, it } from 'vitest';
import {
  haversineKm,
  isLocated,
  nearestNeighbour,
  optimiseRoute,
  routeLengthKm,
  twoOpt,
  type RoutableStop,
} from './routing.js';

/** Real coordinates, so a wrong answer is recognisably wrong on a map. */
const ALGIERS = { latitude: 36.7538, longitude: 3.0588 };
const BAB_EZZOUAR = { latitude: 36.7167, longitude: 3.1833 };
const BLIDA = { latitude: 36.4703, longitude: 2.8277 };
const BOUMERDES = { latitude: 36.7592, longitude: 3.4772 };
const ORAN = { latitude: 35.6971, longitude: -0.6308 };

const stop = (id: string, point: { latitude: number; longitude: number }): RoutableStop => ({
  id,
  ...point,
});

describe('haversineKm', () => {
  it('is zero between a point and itself', () => {
    expect(haversineKm(ALGIERS, ALGIERS)).toBe(0);
  });

  it('matches the known Algiers-Oran distance within a kilometre', () => {
    // ~351 km great-circle; road distance is closer to 430.
    expect(haversineKm(ALGIERS, ORAN)).toBeGreaterThan(350);
    expect(haversineKm(ALGIERS, ORAN)).toBeLessThan(352);
  });

  it('is symmetric', () => {
    expect(haversineKm(ALGIERS, BLIDA)).toBeCloseTo(haversineKm(BLIDA, ALGIERS), 9);
  });

  it('handles the antipodes without returning NaN', () => {
    const distance = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(20_000);
  });
});

describe('routeLengthKm', () => {
  it('is zero for no stops', () => {
    expect(routeLengthKm(ALGIERS, [])).toBe(0);
  });

  it('counts the leg from the depot when there is one', () => {
    const withDepot = routeLengthKm(ALGIERS, [stop('a', BLIDA)]);
    const withoutDepot = routeLengthKm(null, [stop('a', BLIDA)]);
    expect(withDepot).toBeGreaterThan(0);
    expect(withoutDepot).toBe(0);
  });

  it('adds every leg in the order given', () => {
    const route = [stop('a', BAB_EZZOUAR), stop('b', BOUMERDES)];
    const expected = haversineKm(ALGIERS, BAB_EZZOUAR) + haversineKm(BAB_EZZOUAR, BOUMERDES);
    expect(routeLengthKm(ALGIERS, route)).toBeCloseTo(expected, 9);
  });
});

describe('nearestNeighbour', () => {
  it('starts with the stop closest to the depot', () => {
    const ordered = nearestNeighbour(ALGIERS, [
      stop('oran', ORAN),
      stop('blida', BLIDA),
      stop('babez', BAB_EZZOUAR),
    ]);
    expect(ordered[0]!.id).toBe('babez');
  });

  it('never drops or duplicates a stop', () => {
    const stops = [stop('a', ORAN), stop('b', BLIDA), stop('c', BOUMERDES)];
    const ordered = nearestNeighbour(ALGIERS, stops);
    expect(ordered.map((entry) => entry.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps unlocatable stops, at the end and in their given order', () => {
    const ordered = nearestNeighbour(ALGIERS, [
      { id: 'nowhere', latitude: 0, longitude: 0 },
      stop('blida', BLIDA),
      { id: 'unknown', latitude: Number.NaN, longitude: 3 },
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['blida', 'nowhere', 'unknown']);
  });

  it('returns an empty route for no stops', () => {
    expect(nearestNeighbour(ALGIERS, [])).toEqual([]);
  });

  it('keeps the given order when there is no depot to start from', () => {
    const ordered = nearestNeighbour(null, [stop('a', ORAN), stop('b', BLIDA)]);
    expect(ordered[0]!.id).toBe('a');
  });
});

describe('twoOpt', () => {
  it('untangles a route that crosses itself', () => {
    // Four corners of a square, given in an order that crosses the diagonal.
    const square = [
      stop('nw', { latitude: 36.8, longitude: 3.0 }),
      stop('se', { latitude: 36.6, longitude: 3.2 }),
      stop('ne', { latitude: 36.8, longitude: 3.2 }),
      stop('sw', { latitude: 36.6, longitude: 3.0 }),
    ];
    const before = routeLengthKm(null, square);
    const after = routeLengthKm(null, twoOpt(null, square));
    expect(after).toBeLessThan(before);
  });

  it('leaves a route of three alone', () => {
    const three = [stop('a', ALGIERS), stop('b', BLIDA), stop('c', ORAN)];
    expect(twoOpt(null, three).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('never loses a stop', () => {
    const stops = [
      stop('a', ALGIERS),
      stop('b', BLIDA),
      stop('c', ORAN),
      stop('d', BOUMERDES),
      stop('e', BAB_EZZOUAR),
    ];
    expect(twoOpt(ALGIERS, stops)).toHaveLength(5);
  });

  it('terminates on identical points instead of flipping forever', () => {
    const same = Array.from({ length: 6 }, (_, index) => stop(`s${index}`, ALGIERS));
    expect(twoOpt(ALGIERS, same)).toHaveLength(6);
  });
});

describe('optimiseRoute', () => {
  it('is never longer than the nearest-neighbour route it starts from', () => {
    const stops = [
      stop('a', BOUMERDES),
      stop('b', BLIDA),
      stop('c', BAB_EZZOUAR),
      stop('d', { latitude: 36.72, longitude: 2.9 }),
      stop('e', { latitude: 36.9, longitude: 3.3 }),
    ];
    const greedy = routeLengthKm(ALGIERS, nearestNeighbour(ALGIERS, stops));
    const optimised = routeLengthKm(ALGIERS, optimiseRoute(ALGIERS, stops));
    expect(optimised).toBeLessThanOrEqual(greedy + 1e-9);
  });

  it('handles a single stop', () => {
    expect(optimiseRoute(ALGIERS, [stop('a', BLIDA)]).map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('isLocated', () => {
  it('accepts a real coordinate', () => {
    expect(isLocated(ALGIERS)).toBe(true);
  });

  it('rejects null island, which is what an unset column becomes', () => {
    expect(isLocated({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it('rejects missing, non-finite and out-of-range values', () => {
    expect(isLocated({})).toBe(false);
    expect(isLocated({ latitude: 36, longitude: undefined })).toBe(false);
    expect(isLocated({ latitude: Number.NaN, longitude: 3 })).toBe(false);
    expect(isLocated({ latitude: 91, longitude: 3 })).toBe(false);
    expect(isLocated({ latitude: 36, longitude: 181 })).toBe(false);
  });

  it('accepts a point on one axis only', () => {
    expect(isLocated({ latitude: 0, longitude: 3.0588 })).toBe(true);
  });
});
