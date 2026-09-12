import { describe, expect, it } from 'vitest';
import { __wilayaMapInternals } from './WilayaMap';

const { project, radiusFor, toneFor, VIEW } = __wilayaMapInternals;

/**
 * The map of Algeria on the dashboard.
 *
 * Its correctness is geographic, not arithmetic, so these assert against places rather
 * than against numbers: Algiers is north of Tamanrasset, Oran is west of Annaba. A
 * projection that silently flipped an axis would look plausible and be wrong, and it is
 * the kind of wrong nobody notices on a map of a country they are not from.
 *
 * The coordinates are the real chef-lieux, the same ones the seed loads and the delivery
 * routing measures distance from.
 */

const PLACES = {
  alger: { lat: 36.753, lng: 3.059 },
  oran: { lat: 35.697, lng: -0.633 },
  annaba: { lat: 36.9, lng: 7.766 },
  tamanrasset: { lat: 22.785, lng: 5.523 },
  tindouf: { lat: 27.674, lng: -8.147 },
  illizi: { lat: 26.483, lng: 8.467 },
};

describe('project', () => {
  it('puts the north above the south', () => {
    // y grows downwards in SVG, so northern places have the smaller y.
    expect(project(PLACES.alger.lat, PLACES.alger.lng).y).toBeLessThan(
      project(PLACES.tamanrasset.lat, PLACES.tamanrasset.lng).y,
    );
  });

  it('puts the west left of the east', () => {
    expect(project(PLACES.oran.lat, PLACES.oran.lng).x).toBeLessThan(
      project(PLACES.annaba.lat, PLACES.annaba.lng).x,
    );

    expect(project(PLACES.tindouf.lat, PLACES.tindouf.lng).x).toBeLessThan(
      project(PLACES.illizi.lat, PLACES.illizi.lng).x,
    );
  });

  it('keeps every chef-lieu clear of the frame by a full disc', () => {
    // The largest disc is 34px. Most orders come from the northern strip, so those are
    // the biggest discs and the ones that were being clipped before the bounds widened.
    const margin = 34;

    for (const [name, place] of Object.entries(PLACES)) {
      const { x, y } = project(place.lat, place.lng);

      expect(x, `${name} x`).toBeGreaterThanOrEqual(margin);
      expect(x, `${name} x`).toBeLessThanOrEqual(VIEW.width - margin);
      expect(y, `${name} y`).toBeGreaterThanOrEqual(margin);
      expect(y, `${name} y`).toBeLessThanOrEqual(VIEW.height - margin);
    }
  });

  it('never places a point outside the drawing, however wrong the input', () => {
    // A coordinate from bad data must not push a disc off the canvas and out of reach.
    const far = project(80, 120);

    expect(far.x).toBeGreaterThanOrEqual(0);
    expect(far.x).toBeLessThanOrEqual(VIEW.width);
    expect(far.y).toBeGreaterThanOrEqual(0);
    expect(far.y).toBeLessThanOrEqual(VIEW.height);
  });
});

describe('radiusFor', () => {
  it('scales by area, so twice the orders is twice the ink', () => {
    // Radius would make it look four times bigger, which overstates the difference.
    const busiest = 100;
    const half = radiusFor(50, busiest);
    const full = radiusFor(100, busiest);

    const areaRatio = (full * full) / (half * half);
    expect(areaRatio).toBeGreaterThan(1.6);
    expect(areaRatio).toBeLessThan(2.6);
  });

  it('keeps the smallest wilaya visible rather than invisible', () => {
    expect(radiusFor(1, 5000)).toBeGreaterThanOrEqual(4);
  });

  it('never exceeds the largest disc it promises', () => {
    expect(radiusFor(5000, 5000)).toBeLessThanOrEqual(34);
  });
});

describe('toneFor', () => {
  it('calls a wilaya that mostly delivers a success', () => {
    expect(toneFor({ successRate: 92, delivered: 40 } as never)).toContain('success');
  });

  it('calls a wilaya that mostly does not a danger', () => {
    // The expensive case: orders arrive and parcels come back.
    expect(toneFor({ successRate: 55, delivered: 10 } as never)).toContain('danger');
  });

  it('leaves a wilaya with nothing finished neutral, not failing', () => {
    // A first order placed this morning has no rate to judge yet.
    expect(toneFor({ successRate: 0, delivered: 0 } as never)).toContain('muted');
  });
});
