/**
 * Courier settlement and cash arithmetic — PRD F-AD-64.
 *
 * A courier collects cash at the door on our behalf, keeps a delivery fee and a
 * percentage of the cash they handled, and pays us the rest weeks later. Getting this
 * wrong in our favour loses the relationship; getting it wrong in theirs loses money
 * quietly for months, so every number here is derived and tested rather than typed.
 *
 * All amounts are minor units (centimes). Fees round half-up, in our favour on an exact
 * half, because that is what the courier's own statement does.
 */

export interface SettlementCandidate {
  orderId: string;
  /** Cash the courier collected from the customer. */
  codAmountMinor: bigint;
  /** Delivery fee we owe the courier for this parcel. */
  shippingCostMinor: bigint;
}

export interface SettlementLineResult {
  orderId: string;
  codAmountMinor: bigint;
  feeAmountMinor: bigint;
  netAmountMinor: bigint;
}

export interface SettlementTotals {
  lines: SettlementLineResult[];
  /** Everything the courier collected. */
  grossMinor: bigint;
  /** Delivery fees plus the COD commission. */
  feesMinor: bigint;
  /** What the courier owes us. */
  netMinor: bigint;
}

/**
 * Rounds a fraction of minor units to whole minor units, half away from zero.
 *
 * Banker's rounding would be defensible, but no Algerian courier's statement uses it,
 * and a reconciliation that disagrees by one centime on half the lines is worse than
 * one that is a centime generous.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Cannot divide by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/**
 * The COD commission on one collection.
 *
 * `percent` arrives as a decimal string or number with up to two places (1.75 %), so it
 * is scaled to hundredths of a percent before touching bigint arithmetic. Doing this in
 * floating point on a 2 400 000 centime order is how a rounding bug reaches a statement.
 */
export function codFee(amountMinor: bigint, percent: number | string): bigint {
  const basisPoints = toBasisPoints(percent);
  if (basisPoints === 0n || amountMinor === 0n) return 0n;
  return roundHalfUp(amountMinor * basisPoints, 10_000n);
}

/** Percent as hundredths of a percent, without floating-point drift. */
export function toBasisPoints(percent: number | string): bigint {
  const text = typeof percent === 'number' ? percent.toFixed(2) : percent.trim();
  const match = /^(-?)(\d*)(?:\.(\d{0,2}))?\d*$/.exec(text);
  if (!match) throw new Error(`Not a percentage: ${String(percent)}`);
  const [, sign, whole, fraction = ''] = match;
  const scaled = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return sign === '-' ? -scaled : scaled;
}

/**
 * Turns delivered orders into settlement lines.
 *
 * Every line is computed, never carried over from the order: an order's shipping cost
 * can be edited after the fact, and a settlement must reflect the agreement in force
 * when the parcel moved, which is what the candidate carries.
 */
export function buildSettlement(
  candidates: SettlementCandidate[],
  codFeePercent: number | string,
): SettlementTotals {
  const lines = candidates.map((candidate) => {
    const commission = codFee(candidate.codAmountMinor, codFeePercent);
    const feeAmountMinor = candidate.shippingCostMinor + commission;
    return {
      orderId: candidate.orderId,
      codAmountMinor: candidate.codAmountMinor,
      feeAmountMinor,
      netAmountMinor: candidate.codAmountMinor - feeAmountMinor,
    };
  });

  return {
    lines,
    grossMinor: sum(lines, (line) => line.codAmountMinor),
    feesMinor: sum(lines, (line) => line.feeAmountMinor),
    netMinor: sum(lines, (line) => line.netAmountMinor),
  };
}

/**
 * What is still owed on a settlement.
 *
 * Positive means the courier owes us; negative means they overpaid, which happens when
 * a return is credited twice and is worth surfacing rather than hiding behind a clamp.
 */
export function settlementDifference(netMinor: bigint, paidMinor: bigint): bigint {
  return netMinor - paidMinor;
}

export interface CashPosition {
  expectedMinor: bigint;
  collectedMinor: bigint;
  reconciledMinor: bigint;
}

/**
 * The cash a holder is sitting on: collected but not yet counted in.
 *
 * Expected is what the delivered orders say should have been collected. A shortfall
 * against it is a question for the driver; the outstanding figure is a question for the
 * cashier. They are different problems, so they are different numbers.
 */
export function cashOutstanding(position: CashPosition): bigint {
  const outstanding = position.collectedMinor - position.reconciledMinor;
  return outstanding > 0n ? outstanding : 0n;
}

/** Collected less than the orders say was due. Negative means an overcollection. */
export function cashVariance(position: CashPosition): bigint {
  return position.collectedMinor - position.expectedMinor;
}

function sum<T>(items: T[], read: (item: T) => bigint): bigint {
  return items.reduce((total, item) => total + read(item), 0n);
}
