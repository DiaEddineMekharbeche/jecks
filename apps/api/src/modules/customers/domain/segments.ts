/**
 * Customer segments — PRD F-AD-40.
 *
 * Five buckets, computed nightly from what a customer has actually done. Pure, because
 * the thresholds are a business decision that will be argued about, and an argument is
 * easier when the rule can be read in one place.
 *
 * The order of the checks is the rule. Blacklisted beats everything; a customer who has
 * not come back in a long time is at risk whatever they used to spend; and VIP is about
 * money *and* repetition, so a single large order does not buy the label.
 */

export type Segment = 'NEW' | 'RETURNING' | 'VIP' | 'AT_RISK' | 'BLACKLISTED';

export interface SegmentPolicy {
  /** Delivered orders needed to stop being new. */
  returningAfterOrders: number;
  /** Lifetime value, in centimes, that qualifies for VIP. */
  vipLifetimeValueMinor: bigint;
  /** Delivered orders needed alongside that value. */
  vipOrders: number;
  /** Days of silence after which a customer is at risk. */
  atRiskAfterDays: number;
}

export const DEFAULT_SEGMENT_POLICY: SegmentPolicy = {
  returningAfterOrders: 2,
  vipLifetimeValueMinor: 5_000_000n,
  vipOrders: 3,
  atRiskAfterDays: 90,
};

export interface CustomerSignals {
  blacklisted: boolean;
  deliveredCount: number;
  lifetimeValueMinor: bigint;
  lastOrderAt: Date | null;
}

export function segmentOf(
  signals: CustomerSignals,
  now: Date = new Date(),
  policy: SegmentPolicy = DEFAULT_SEGMENT_POLICY,
): Segment {
  if (signals.blacklisted) return 'BLACKLISTED';

  // Nobody who has never received an order is at risk of being lost; they are new.
  if (signals.deliveredCount === 0) return 'NEW';

  const silentDays = signals.lastOrderAt
    ? Math.floor((now.getTime() - signals.lastOrderAt.getTime()) / 86_400_000)
    : Number.POSITIVE_INFINITY;

  if (silentDays >= policy.atRiskAfterDays) return 'AT_RISK';

  if (
    signals.deliveredCount >= policy.vipOrders &&
    signals.lifetimeValueMinor >= policy.vipLifetimeValueMinor
  ) {
    return 'VIP';
  }

  if (signals.deliveredCount >= policy.returningAfterOrders) return 'RETURNING';

  return 'NEW';
}

/**
 * How reliable a customer is at the door.
 *
 * A percentage over attempts, not over orders placed: a customer with one delivered and
 * one cancelled order never had a second delivery attempted, and counting the
 * cancellation against them would be wrong.
 */
export function deliveryReliability(signals: {
  deliveredCount: number;
  failedCount: number;
}): number | null {
  const attempts = signals.deliveredCount + signals.failedCount;
  if (attempts === 0) return null;
  return Math.round((signals.deliveredCount / attempts) * 1000) / 10;
}

/** Average order value over delivered orders, which is the only kind that was paid. */
export function averageOrderValue(signals: {
  deliveredCount: number;
  lifetimeValueMinor: bigint;
}): bigint {
  if (signals.deliveredCount <= 0) return 0n;
  return signals.lifetimeValueMinor / BigInt(signals.deliveredCount);
}

/**
 * Days between a customer's orders, over their history.
 *
 * Used to spot who is overdue. Fewer than two orders gives null: one order says nothing
 * about a rhythm, and inventing one produces a "customer is late" alert for everybody
 * who ever bought once.
 */
export function averageDaysBetweenOrders(orderDates: Date[]): number | null {
  if (orderDates.length < 2) return null;

  const sorted = [...orderDates].sort((a, b) => a.getTime() - b.getTime());
  const span = sorted[sorted.length - 1]!.getTime() - sorted[0]!.getTime();

  return Math.round(span / 86_400_000 / (sorted.length - 1));
}

/**
 * Whether a returning customer is later than usual.
 *
 * Half again their own rhythm, so a customer who buys monthly is flagged at six weeks
 * and one who buys yearly is not flagged in February.
 */
export function isOverdue(
  lastOrderAt: Date | null,
  averageDays: number | null,
  now: Date = new Date(),
): boolean {
  if (!lastOrderAt || averageDays === null || averageDays <= 0) return false;
  const silentDays = (now.getTime() - lastOrderAt.getTime()) / 86_400_000;
  return silentDays > averageDays * 1.5;
}
