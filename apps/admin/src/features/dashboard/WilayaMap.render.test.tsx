import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WilayaMap, type WilayaPoint } from './WilayaMap';

/**
 * The map as it actually renders.
 *
 * Not a snapshot — those fail on every design change and pass through every real
 * defect. What is asserted is what the drawing must contain: one disc per wilaya, a
 * readable label for each, and something sensible when there is no data, which is the
 * state a shop is in on its first day.
 */

afterEach(cleanup);

function point(overrides: Partial<WilayaPoint> & { wilayaCode: number }): WilayaPoint {
  return {
    wilayaName: `Wilaya ${overrides.wilayaCode}`,
    orders: 10,
    delivered: 8,
    successRate: 80,
    latitude: 36.75,
    longitude: 3.05,
    ...overrides,
  };
}

describe('WilayaMap', () => {
  it('draws a disc for every wilaya that has orders', () => {
    const { container } = render(
      <WilayaMap
        points={[
          point({ wilayaCode: 16, wilayaName: 'Alger' }),
          point({ wilayaCode: 31, wilayaName: 'Oran', latitude: 35.69, longitude: -0.63 }),
          point({ wilayaCode: 23, wilayaName: 'Annaba', latitude: 36.9, longitude: 7.76 }),
        ]}
      />,
    );

    // Two circles per wilaya: the disc, and a larger transparent hover target, because
    // a low-volume wilaya is only a few pixels across.
    expect(container.querySelectorAll('circle')).toHaveLength(6);
  });

  it('names each wilaya and its figures for a screen reader', () => {
    render(<WilayaMap points={[point({ wilayaCode: 16, wilayaName: 'Alger', orders: 62 })]} />);

    // The <title> inside the hover target is what a screen reader announces.
    const titles = [...document.querySelectorAll('title')].map((node) => node.textContent);
    expect(titles.some((text) => text?.includes('Alger') && text.includes('62 commandes'))).toBe(
      true,
    );
  });

  it('says so when there is nothing to draw, rather than an empty box', () => {
    render(<WilayaMap points={[]} />);

    expect(screen.getByText(/Aucune commande/)).toBeDefined();
  });

  it('does not draw a wilaya whose coordinates are missing, and says how many', () => {
    render(
      <WilayaMap
        points={[
          point({ wilayaCode: 16, wilayaName: 'Alger' }),
          point({ wilayaCode: 55, wilayaName: 'Touggourt', latitude: null, longitude: null }),
        ]}
      />,
    );

    // Silently dropping it would make the totals on the map disagree with the table
    // beside it, and nobody would know why.
    expect(screen.getByText(/1 wilaya sans coordonnées/)).toBeDefined();
  });

  it('carries a legend, because colour is meaningless without one', () => {
    render(<WilayaMap points={[point({ wilayaCode: 16 })]} />);

    expect(screen.getByText(/85 % livrées/)).toBeDefined();
    expect(screen.getByText(/taille du disque/i)).toBeDefined();
  });

  it('labels the drawing itself', () => {
    render(<WilayaMap points={[point({ wilayaCode: 16 })]} />);

    expect(screen.getByRole('img', { name: /Commandes par wilaya/ })).toBeDefined();
  });
});
