import { cn } from '@jecks/ui';
import { useMemo, useState } from 'react';

/**
 * Where the orders come from — PRD F-AD-04.
 *
 * A proportional-symbol map, not a choropleth. The plan asked for a choropleth from a
 * bundled GeoJSON and there is no wilaya boundary set in the repository; drawing an
 * approximation of a country's internal borders would be worse than drawing none, so
 * this places a disc at each chef-lieu instead. The coordinates are the real ones the
 * seed loads, and they are also what the delivery routing measures distance from.
 *
 * Area carries the volume and colour carries the success rate, because those are two
 * different questions and a wilaya that orders often and receives rarely is the one
 * worth finding. Encoding volume as area rather than radius matters: a disc with twice
 * the radius looks four times the size, which overstates the difference.
 */

export interface WilayaPoint {
  wilayaCode: number;
  wilayaName: string;
  orders: number;
  delivered: number;
  successRate: number;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Algeria's bounding box, with room around it.
 *
 * Deliberately wider than the country. Almost every order comes from the northern
 * strip, so the largest discs sit at the top — drawn to the true extent they were cut
 * off by the edge of the frame.
 */
const BOUNDS = { west: -9.6, east: 12.6, south: 17.8, north: 38.6 };

const VIEW = { width: 640, height: 560 };

export function WilayaMap({ points }: { points: WilayaPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const placed = useMemo(
    () =>
      points
        .filter(
          (point): point is WilayaPoint & { latitude: number; longitude: number } =>
            point.latitude !== null && point.longitude !== null,
        )
        .map((point) => ({ ...point, ...project(point.latitude, point.longitude) }))
        // Biggest first, so a small wilaya sitting on top of a large one stays clickable.
        .sort((a, b) => b.orders - a.orders),
    [points],
  );

  const busiest = Math.max(1, ...placed.map((point) => point.orders));
  const missing = points.length - placed.length;

  if (placed.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        Aucune commande sur cette période.
      </p>
    );
  }

  const active = placed.find((point) => point.wilayaCode === hovered);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Commandes par wilaya"
      >
        <title>Commandes par wilaya</title>

        {placed.map((point) => {
          const radius = radiusFor(point.orders, busiest);
          const isActive = point.wilayaCode === hovered;

          return (
            <g key={point.wilayaCode}>
              <circle
                cx={point.x}
                cy={point.y}
                r={radius}
                className={cn('transition-opacity', isActive ? 'opacity-100' : 'opacity-80')}
                fill={toneFor(point)}
                stroke="var(--color-base)"
                strokeWidth={1}
              />
              {/* A generous transparent target: the small wilayas are a few pixels wide. */}
              <circle
                cx={point.x}
                cy={point.y}
                r={Math.max(radius, 12)}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHovered(point.wilayaCode)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${point.wilayaName} — ${point.orders} commande${
                  point.orders > 1 ? 's' : ''
                }, ${point.successRate} % livrées`}</title>
              </circle>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="flex items-center gap-3">
          <Legend colour="var(--color-success)" label="≥ 85 % livrées" />
          <Legend colour="var(--color-brass)" label="70–85 %" />
          <Legend colour="var(--color-danger)" label="< 70 %" />
        </span>
        <span>La taille du disque indique le nombre de commandes.</span>
      </div>

      {missing > 0 ? (
        <p className="mt-1 text-xs text-muted">
          {missing} wilaya{missing > 1 ? 's' : ''} sans coordonnées ne{missing > 1 ? ' ' : ' '}
          figure{missing > 1 ? 'nt' : ''} pas sur la carte.
        </p>
      ) : null}

      {active ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
          <p className="rounded-sm border border-line bg-elevated px-3 py-1.5 text-xs text-ink shadow">
            <span className="font-medium">{active.wilayaName}</span> · {active.orders} commande
            {active.orders > 1 ? 's' : ''} · {active.delivered} livrée
            {active.delivered > 1 ? 's' : ''} · {active.successRate} %
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour }} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Equirectangular, which is honest at this scale.
 *
 * Algeria spans about 18 degrees of latitude, where the distortion from not projecting
 * properly is small and the alternative is bundling a projection library to move
 * fifty-eight dots by a few pixels.
 */
function project(latitude: number, longitude: number): { x: number; y: number } {
  const x = ((longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * VIEW.width;
  const y = ((BOUNDS.north - latitude) / (BOUNDS.north - BOUNDS.south)) * VIEW.height;

  return { x: clamp(x, 8, VIEW.width - 8), y: clamp(y, 8, VIEW.height - 8) };
}

/** Area proportional to volume, so the eye reads the ratio correctly. */
function radiusFor(orders: number, busiest: number): number {
  const min = 4;
  const max = 34;
  return min + (max - min) * Math.sqrt(orders / busiest);
}

function toneFor(point: WilayaPoint): string {
  // A wilaya with nothing finished yet has no rate to judge, so it stays neutral rather
  // than being painted as a failure.
  if (point.delivered === 0 && point.successRate === 0) return 'var(--color-muted)';
  if (point.successRate >= 85) return 'var(--color-success)';
  if (point.successRate >= 70) return 'var(--color-brass)';
  return 'var(--color-danger)';
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export const __wilayaMapInternals = { project, radiusFor, toneFor, BOUNDS, VIEW };
