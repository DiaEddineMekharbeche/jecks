import { useMemo } from 'react';

/**
 * The shape of a round — PRD F-AD-63.
 *
 * Not Leaflet over OpenStreetMap tiles, which the plan suggested. Two reasons, and the
 * second is the one that decided it.
 *
 * A tile map needs the network, and a dispatcher planning tomorrow's rounds from a back
 * office on a bad connection gets a grey rectangle. More importantly, the coordinates
 * behind these stops are frequently the wilaya's chef-lieu rather than the customer's
 * street, because the bundled dataset has no commune centroids (D74). Drawing coarse
 * points on a street map implies a precision that is not there; drawing them on a plain
 * sketch does not.
 *
 * What this answers is the question a planner actually has: does the order of the stops
 * make sense, or does it cross the city twice.
 */

export interface RunStopPoint {
  id: string;
  position: number;
  orderNumber: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
}

const VIEW = { width: 520, height: 320 };
const PADDING = 34;

export function RunMap({ stops }: { stops: RunStopPoint[] }) {
  const placed = useMemo(() => layout(stops), [stops]);

  if (placed.length < 2) {
    return (
      <p className="px-4 py-6 text-sm text-muted">
        {placed.length === 0
          ? 'Aucun arrêt géolocalisé sur cette tournée.'
          : 'Un seul arrêt géolocalisé : rien à tracer.'}
      </p>
    );
  }

  const path = placed.map((stop) => `${stop.x},${stop.y}`).join(' ');

  return (
    <div className="px-4 pb-4">
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Tracé de la tournée"
      >
        <title>Tracé de la tournée</title>

        {/* The order of the stops, drawn before the discs so the line passes behind. */}
        <polyline
          points={path}
          fill="none"
          stroke="var(--color-brass)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.7}
        />

        {placed.map((stop) => (
          <g key={stop.id}>
            <circle
              cx={stop.x}
              cy={stop.y}
              r={13}
              fill={fillFor(stop.status)}
              stroke="var(--color-base)"
              strokeWidth={1.5}
            />
            <text
              x={stop.x}
              y={stop.y + 4}
              textAnchor="middle"
              className="fill-base text-[11px] font-semibold"
            >
              {stop.position}
            </text>
            <title>{`${stop.position}. ${stop.orderNumber}`}</title>
          </g>
        ))}
      </svg>

      <p className="mt-1 text-xs text-muted">
        Croquis à l’échelle des arrêts, pas une carte routière. Les distances sont à vol
        d’oiseau.
      </p>
    </div>
  );
}

/**
 * Fits the stops to the frame.
 *
 * The extent is computed from the stops themselves rather than from a fixed box: a
 * round inside one commune and a round across three wilayas both need to fill the
 * drawing, and a shared scale would render the first one as a single dot.
 */
function layout(stops: RunStopPoint[]): Array<RunStopPoint & { x: number; y: number }> {
  const located = stops
    .filter(
      (stop): stop is RunStopPoint & { latitude: number; longitude: number } =>
        stop.latitude !== null && stop.longitude !== null,
    )
    .sort((a, b) => a.position - b.position);

  if (located.length === 0) return [];

  const lats = located.map((stop) => stop.latitude);
  const lngs = located.map((stop) => stop.longitude);

  // A minimum span stops a round whose stops share one coordinate from dividing by zero
  // and from being blown up to fill the frame on rounding noise alone.
  const minSpan = 0.01;
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  const spanX = Math.max(east - west, minSpan);
  const spanY = Math.max(north - south, minSpan);

  const usableWidth = VIEW.width - PADDING * 2;
  const usableHeight = VIEW.height - PADDING * 2;

  return located.map((stop) => ({
    ...stop,
    x: PADDING + ((stop.longitude - west) / spanX) * usableWidth,
    y: PADDING + ((north - stop.latitude) / spanY) * usableHeight,
  }));
}

function fillFor(status: string): string {
  if (status === 'DELIVERED') return 'var(--color-success)';
  if (status === 'FAILED') return 'var(--color-danger)';
  if (status === 'RESCHEDULED') return 'var(--color-brass)';
  return 'var(--color-muted)';
}

export const __runMapInternals = { layout, VIEW, PADDING };
