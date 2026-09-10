/**
 * Profit and loss — PRD F-AD-70.
 *
 * Pure arithmetic over rows the caller has already fetched. It lives in the shared
 * package because two processes need the same answer: the API serves the report and the
 * worker writes the nightly `daily_stats` row. Two implementations would disagree, and
 * on the day they did nobody would know which one was lying.
 *
 * The definition, in order:
 *
 *   revenue        what customers paid for goods
 *   − cost of goods what those goods cost us
 *   = gross profit
 *   + delivery revenue − delivery cost
 *   − discounts        already granted, shown so they can be seen
 *   − payment fees     gateway and courier commission
 *   − refunds          money handed back
 *   − expenses         rent, salaries, everything else
 *   − ad spend
 *   = net profit
 *
 * Discounts are *not* subtracted from revenue here: revenue is what was actually
 * charged, which already has the discount taken off. Subtracting again would count it
 * twice, which is the single most common way a shop's P&L reads worse than reality.
 * The discount line is reported for visibility only.
 */

export interface PnlInput {
  /** Goods revenue, net of discounts, from orders that count as sold. */
  revenueMinor: bigint;
  /** What those goods cost, from the cost snapshotted on each order line. */
  cogsMinor: bigint;
  /** Delivery charged to customers. */
  shippingRevenueMinor: bigint;
  /** Delivery paid to couriers and drivers. */
  shippingCostMinor: bigint;
  /** Discounts granted, for the report only. */
  discountsMinor: bigint;
  /** Gateway and courier COD commission. */
  paymentFeesMinor: bigint;
  refundsMinor: bigint;
  expensesMinor: bigint;
  adSpendMinor: bigint;
}

export interface PnlResult extends PnlInput {
  grossProfitMinor: bigint;
  shippingMarginMinor: bigint;
  /** Gross profit plus the delivery margin: what trading left before overheads. */
  contributionMinor: bigint;
  netProfitMinor: bigint;
  /** Gross profit over revenue, as a percentage with one decimal. */
  grossMarginPercent: number;
  netMarginPercent: number;
}

export function computePnl(input: PnlInput): PnlResult {
  const grossProfitMinor = input.revenueMinor - input.cogsMinor;
  const shippingMarginMinor = input.shippingRevenueMinor - input.shippingCostMinor;
  const contributionMinor = grossProfitMinor + shippingMarginMinor;

  const netProfitMinor =
    contributionMinor -
    input.paymentFeesMinor -
    input.refundsMinor -
    input.expensesMinor -
    input.adSpendMinor;

  return {
    ...input,
    grossProfitMinor,
    shippingMarginMinor,
    contributionMinor,
    netProfitMinor,
    grossMarginPercent: shareOf(grossProfitMinor, input.revenueMinor),
    netMarginPercent: shareOf(netProfitMinor, input.revenueMinor),
  };
}

/**
 * A share of a base, as a percentage with one decimal.
 *
 * Named `shareOf` rather than `percentOf` because the money module already has that
 * name for taking a percentage *of* an amount, which is the opposite operation.
 *
 * A zero base returns zero rather than infinity: a period with no sales has no margin,
 * and rendering "Infinity %" on a dashboard is worse than saying nothing.
 */
export function shareOf(part: bigint, base: bigint): number {
  if (base === 0n) return 0;
  // Scaled by 1000 before converting, so one decimal survives integer division.
  const scaled = (part * 1000n) / base;
  return Number(scaled) / 10;
}

/** Empty totals, so a grouping can start from something. */
export function emptyPnl(): PnlInput {
  return {
    revenueMinor: 0n,
    cogsMinor: 0n,
    shippingRevenueMinor: 0n,
    shippingCostMinor: 0n,
    discountsMinor: 0n,
    paymentFeesMinor: 0n,
    refundsMinor: 0n,
    expensesMinor: 0n,
    adSpendMinor: 0n,
  };
}

export function addPnl(a: PnlInput, b: PnlInput): PnlInput {
  return {
    revenueMinor: a.revenueMinor + b.revenueMinor,
    cogsMinor: a.cogsMinor + b.cogsMinor,
    shippingRevenueMinor: a.shippingRevenueMinor + b.shippingRevenueMinor,
    shippingCostMinor: a.shippingCostMinor + b.shippingCostMinor,
    discountsMinor: a.discountsMinor + b.discountsMinor,
    paymentFeesMinor: a.paymentFeesMinor + b.paymentFeesMinor,
    refundsMinor: a.refundsMinor + b.refundsMinor,
    expensesMinor: a.expensesMinor + b.expensesMinor,
    adSpendMinor: a.adSpendMinor + b.adSpendMinor,
  };
}

/**
 * Spreads a period-wide cost across groups in proportion to their revenue.
 *
 * Rent does not belong to a wilaya, but a P&L grouped by wilaya that ignores rent
 * flatters every row. Allocating by revenue is the convention, and the remainder from
 * the division goes to the largest group so the parts always add back to the whole.
 */
export function allocateByRevenue(
  totalMinor: bigint,
  groups: Array<{ key: string; revenueMinor: bigint }>,
): Map<string, bigint> {
  const allocation = new Map<string, bigint>();
  if (groups.length === 0) return allocation;

  const totalRevenue = groups.reduce((sum, group) => sum + group.revenueMinor, 0n);

  if (totalRevenue <= 0n) {
    // No revenue to weigh by: split evenly rather than dropping the cost.
    const each = totalMinor / BigInt(groups.length);
    let remainder = totalMinor - each * BigInt(groups.length);
    for (const group of groups) {
      const extra = remainder > 0n ? 1n : 0n;
      allocation.set(group.key, each + extra);
      remainder -= extra;
    }
    return allocation;
  }

  let assigned = 0n;
  for (const group of groups) {
    const share = (totalMinor * group.revenueMinor) / totalRevenue;
    allocation.set(group.key, share);
    assigned += share;
  }

  const remainder = totalMinor - assigned;
  if (remainder !== 0n) {
    const largest = [...groups].sort((a, b) =>
      a.revenueMinor === b.revenueMinor ? 0 : a.revenueMinor > b.revenueMinor ? -1 : 1,
    )[0]!;
    allocation.set(largest.key, (allocation.get(largest.key) ?? 0n) + remainder);
  }

  return allocation;
}

/**
 * The change between two periods, as a percentage.
 *
 * Null when the earlier period was zero: "up 100 %" from nothing is not information,
 * and a dashboard that says it teaches people to distrust every other number on it.
 */
export function changePercent(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  const scaled = ((current - previous) * 1000n) / (previous < 0n ? -previous : previous);
  return Number(scaled) / 10;
}

/** Return on ad spend: revenue earned per dinar spent, to two decimals. */
export function roas(revenueMinor: bigint, adSpendMinor: bigint): number | null {
  if (adSpendMinor <= 0n) return null;
  return Number((revenueMinor * 100n) / adSpendMinor) / 100;
}

/** What one order cost in advertising. Null when nothing was spent. */
export function costPerOrder(adSpendMinor: bigint, orders: number): bigint | null {
  if (orders <= 0 || adSpendMinor <= 0n) return null;
  return adSpendMinor / BigInt(orders);
}
