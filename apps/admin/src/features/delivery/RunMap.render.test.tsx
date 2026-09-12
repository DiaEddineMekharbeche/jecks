import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RunMap, type RunStopPoint } from './RunMap';

/**
 * The round sketch as it renders.
 *
 * The states that matter are the degenerate ones: a round with no geolocated stops, and
 * a round with exactly one. Both happen — a stop's coordinates come from the wilaya
 * centroid when the commune has none (D74) — and both used to be a polyline with
 * nothing to connect.
 */

afterEach(cleanup);

function stop(position: number, overrides: Partial<RunStopPoint> = {}): RunStopPoint {
  return {
    id: `stop-${position}`,
    position,
    orderNumber: `JK-2609-000${position}`,
    latitude: 36.7 + position * 0.02,
    longitude: 3.0 + position * 0.02,
    status: 'PENDING',
    ...overrides,
  };
}

describe('RunMap', () => {
  it('draws a numbered disc per stop and one line through them', () => {
    const { container } = render(<RunMap stops={[stop(1), stop(2), stop(3)]} />);

    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);

    // The number is what a driver matches against the manifest in their hand.
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('says there is nothing to draw when no stop is geolocated', () => {
    render(<RunMap stops={[stop(1, { latitude: null, longitude: null })]} />);

    expect(screen.getByText(/Aucun arrêt géolocalisé/)).toBeDefined();
  });

  it('refuses to draw a line through a single point', () => {
    const { container } = render(<RunMap stops={[stop(1), stop(2, { latitude: null, longitude: null })]} />);

    expect(screen.getByText(/Un seul arrêt/)).toBeDefined();
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
  });

  it('says on its face that it is a sketch, not a road map', () => {
    // The coordinates are often a wilaya centroid. A drawing that looked like a street
    // map would claim a precision that is not there.
    render(<RunMap stops={[stop(1), stop(2)]} />);

    expect(screen.getByText(/pas une carte routière/)).toBeDefined();
  });

  it('labels the drawing', () => {
    render(<RunMap stops={[stop(1), stop(2)]} />);

    expect(screen.getByRole('img', { name: /Tracé de la tournée/ })).toBeDefined();
  });
});
