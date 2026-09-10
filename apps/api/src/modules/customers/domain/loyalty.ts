/**
 * Loyalty points — PRD Section 6.5.
 *
 * Points are earned when an order is *delivered*, never when it is placed. In a
 * cash-on-delivery market a placed order is a request, not a sale: awarding on checkout
 * would hand points to every customer who refuses the parcel at the door, and those
 * points are money.
 *
 * All rules are pure so the earn rate can be changed in settings without anybody having
 * to reason about what it does to the ledger.
 */

export interface LoyaltyPolicy {
  /** Points earned per whole dinar of goods. Fractions of a point are dropped. */
  pointsPerDinar: number;
  /** What one point is worth in centimes when redeemed. */
  dinarsPerPoint: number;
  /** Redemption cannot cover more than this share of an order. */
  maxRedemptionPercent: number;
  /** Points below this cannot be redeemed at all. */
  minimumRedemption: number;
  /** Points expire after this many days of inactivity; 0 disables expiry. */
  expiryDays: number;
}

export const DEFAULT_LOYALTY_POLICY: LoyaltyPolicy = {
  pointsPerDinar: 1,
  dinarsPerPoint: 1,
  maxRedemptionPercent: 50,
  minimumRedemption: 100,
  expiryDays: 365,
};

/**
 * Points earned by an order.
 *
 * Delivery is excluded from the base: rewarding a customer for living far away costs
 * more the further they are, and shipping is not margin. Anything already discounted is
 * excluded too, because the points would be earned on money never received.
 */
export function pointsForOrder(
  order: { itemsSubtotalMinor: bigint; discountMinor: bigint },
  policy: LoyaltyPolicy = DEFAULT_LOYALTY_POLICY,
): number {
  const base = order.itemsSubtotalMinor - order.discountMinor;
  if (base <= 0n || policy.pointsPerDinar <= 0) return 0;

  const dinars = base / 100n;
  return Math.floor(Number(dinars) * policy.pointsPerDinar);
}

export interface RedemptionRequest {
  points: number;
  balance: number;
  /** What the order comes to before points are applied. */
  payableMinor: bigint;
}

export interface RedemptionResult {
  /** Points actually spent, after every cap. */
  points: number;
  discountMinor: bigint;
  /** Why fewer points were used than asked for, when that happened. */
  reason: 'ok' | 'INSUFFICIENT_BALANCE' | 'BELOW_MINIMUM' | 'CAPPED_BY_ORDER' | 'NOTHING_TO_PAY';
}

/**
 * How many points may actually be spent, and what they are worth.
 *
 * Three caps in order: the balance, the order's share limit, and the order total
 * itself. Applying them in this order means a customer is never told they redeemed
 * points that bought nothing.
 */
export function redeem(
  request: RedemptionRequest,
  policy: LoyaltyPolicy = DEFAULT_LOYALTY_POLICY,
): RedemptionResult {
  const wanted = Math.max(0, Math.trunc(request.points));
  if (wanted === 0 || request.payableMinor <= 0n) {
    return { points: 0, discountMinor: 0n, reason: 'NOTHING_TO_PAY' };
  }

  if (wanted < policy.minimumRedemption) {
    return { points: 0, discountMinor: 0n, reason: 'BELOW_MINIMUM' };
  }

  let points = Math.min(wanted, Math.max(0, request.balance));
  let reason: RedemptionResult['reason'] = points < wanted ? 'INSUFFICIENT_BALANCE' : 'ok';

  if (points < policy.minimumRedemption) {
    return { points: 0, discountMinor: 0n, reason: 'INSUFFICIENT_BALANCE' };
  }

  // What the points are worth, then what the order will accept.
  let discountMinor = BigInt(points) * BigInt(Math.round(policy.dinarsPerPoint * 100));

  const ceiling =
    (request.payableMinor * BigInt(Math.round(policy.maxRedemptionPercent))) / 100n;

  if (discountMinor > ceiling) {
    discountMinor = ceiling;
    // Spend only the points the ceiling actually consumed, rounded down so a customer
    // is never charged points for a centime they did not save.
    points = Number(discountMinor / BigInt(Math.round(policy.dinarsPerPoint * 100)));
    discountMinor = BigInt(points) * BigInt(Math.round(policy.dinarsPerPoint * 100));
    reason = 'CAPPED_BY_ORDER';
  }

  if (points < policy.minimumRedemption) {
    return { points: 0, discountMinor: 0n, reason: 'CAPPED_BY_ORDER' };
  }

  return { points, discountMinor, reason };
}

/** What a balance is worth if it were all spent, ignoring per-order caps. */
export function balanceValue(
  points: number,
  policy: LoyaltyPolicy = DEFAULT_LOYALTY_POLICY,
): bigint {
  if (points <= 0) return 0n;
  return BigInt(Math.trunc(points)) * BigInt(Math.round(policy.dinarsPerPoint * 100));
}

/**
 * The date a balance goes stale, counted from the last activity.
 *
 * Null when expiry is switched off, which is what a shop that has never thought about
 * it should get: silently deleting points is worse than keeping them forever.
 */
export function expiresAt(
  lastActivity: Date,
  policy: LoyaltyPolicy = DEFAULT_LOYALTY_POLICY,
): Date | null {
  if (policy.expiryDays <= 0) return null;
  return new Date(lastActivity.getTime() + policy.expiryDays * 86_400_000);
}

/** Applies a movement to a balance, never letting it go below zero. */
export function applyMovement(balance: number, points: number): number {
  return Math.max(0, Math.trunc(balance) + Math.trunc(points));
}
