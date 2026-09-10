/**
 * Ordering the stops of a delivery run — PRD F-AD-62.
 *
 * Pure functions over coordinates. No database, no clock, no service: a route that
 * cannot be reasoned about on paper cannot be trusted with a driver's day.
 *
 * The problem is a travelling salesman with an open end (the driver does not have to
 * return to the warehouse). Exact answers are not worth their cost for twenty stops, so
 * this takes the nearest neighbour and then improves it with 2-opt until it stops
 * getting better. That lands within a few percent of optimal on real city routes and
 * runs in microseconds.
 */

export interface Point {
  latitude: number;
  longitude: number;
}

export interface RoutableStop extends Point {
  id: string;
}

const EARTH_RADIUS_KM = 6371.008_8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres.
 *
 * Straight-line, not driving distance: we have no road graph, and for ordering stops
 * inside one city the two agree closely enough that the sequence rarely differs.
 */
export function haversineKm(a: Point, b: Point): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a path through the stops, in the order given. */
export function routeLengthKm(start: Point | null, stops: RoutableStop[]): number {
  if (stops.length === 0) return 0;
  let total = start ? haversineKm(start, stops[0]!) : 0;
  for (let index = 1; index < stops.length; index += 1) {
    total += haversineKm(stops[index - 1]!, stops[index]!);
  }
  return total;
}

/**
 * Orders stops from the depot outwards, taking the closest unvisited stop each time.
 *
 * Stops with no coordinates keep their given order and are appended at the end: a stop
 * we cannot place is still a parcel that must be delivered, and dropping it from the
 * route would quietly lose a customer's order.
 */
export function nearestNeighbour(start: Point | null, stops: RoutableStop[]): RoutableStop[] {
  const placeable = stops.filter(isLocated);
  const unplaceable = stops.filter((stop) => !isLocated(stop));

  const remaining = [...placeable];
  const ordered: RoutableStop[] = [];
  let cursor: Point | null = start;

  while (remaining.length > 0) {
    let bestIndex = 0;
    if (cursor) {
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < remaining.length; index += 1) {
        const distance = haversineKm(cursor, remaining[index]!);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    }
    const next = remaining.splice(bestIndex, 1)[0]!;
    ordered.push(next);
    cursor = next;
  }

  return [...ordered, ...unplaceable];
}

/**
 * Untangles a route by reversing segments that cross — the 2-opt improvement.
 *
 * Nearest neighbour is greedy, so it regularly ends with one long leg back across the
 * city. Reversing the segment between two stops removes exactly that kind of crossing,
 * and repeating until no reversal helps converges quickly.
 */
export function twoOpt(
  start: Point | null,
  stops: RoutableStop[],
  maxPasses = 20,
): RoutableStop[] {
  const placeable = stops.filter(isLocated);
  const unplaceable = stops.filter((stop) => !isLocated(stop));
  if (placeable.length < 4) return [...placeable, ...unplaceable];

  let route = [...placeable];
  let best = routeLengthKm(start, route);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;

    for (let i = 0; i < route.length - 1; i += 1) {
      for (let k = i + 1; k < route.length; k += 1) {
        const candidate = [
          ...route.slice(0, i),
          ...route.slice(i, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        const length = routeLengthKm(start, candidate);
        // A strict comparison, so a tie never flips the order back and forth forever.
        if (length < best - 1e-9) {
          route = candidate;
          best = length;
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  return [...route, ...unplaceable];
}

/** Nearest neighbour, then 2-opt: what the "optimise" button runs. */
export function optimiseRoute(start: Point | null, stops: RoutableStop[]): RoutableStop[] {
  return twoOpt(start, nearestNeighbour(start, stops));
}

/**
 * A coordinate is usable when it is a real number inside the globe and not the origin.
 *
 * (0, 0) is in the Atlantic. It is what an unset column looks like once a careless
 * mapper turns null into a number, and one stop there drags an entire Algiers route
 * three thousand kilometres out to sea.
 */
export function isLocated(point: Partial<Point>): point is Point {
  const { latitude, longitude } = point;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  return Math.abs(latitude) > 1e-6 || Math.abs(longitude) > 1e-6;
}
