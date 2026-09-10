/**
 * Weighted-average cost — PRD F-AD-52 ("receiving updates on-hand and the weighted
 * average cost") and the M1.3 definition of done.
 *
 * Pure functions, no Prisma: the arithmetic that decides every future COGS figure is
 * the one thing in inventory that must be provable in a unit test rather than argued
 * about over a database.
 *
 * All amounts are minor units as bigint. The average is rounded half-up to the nearest
 * minor unit, because a cost carried to fractions of a centime cannot be stored and
 * silently truncating it would bias every receipt downwards.
 */

export interface CostPosition {
  /** Units already on hand across every location, before this receipt. */
  quantity: number;
  /** The variant's current cost per unit, minor units. */
  unitCostMinor: bigint;
}

export interface CostReceipt {
  quantity: number;
  unitCostMinor: bigint;
  /** Freight and duties spread across the received units, minor units. */
  landedExtraMinor?: bigint;
}

/**
 * The new cost per unit after a receipt.
 *
 * Two cases have to be right or the ledger drifts:
 *
 * - An empty position (or one whose on-hand went negative through oversell) adopts the
 *   receipt cost outright. Averaging against a negative quantity would produce a cost
 *   with no physical meaning.
 * - A receipt of zero units leaves the cost alone. A "receive nothing" click is a
 *   no-op, not a reason to reprice inventory.
 */
export function weightedAverageCost(position: CostPosition, receipt: CostReceipt): bigint {
  const receivedQty = Math.trunc(receipt.quantity);
  if (receivedQty <= 0) return position.unitCostMinor;

  const landed = landedUnitCost(receipt);
  const heldQty = Math.trunc(position.quantity);
  if (heldQty <= 0) return landed;

  const heldValue = position.unitCostMinor * BigInt(heldQty);
  const receivedValue = landed * BigInt(receivedQty);
  return divideRoundHalfUp(heldValue + receivedValue, BigInt(heldQty + receivedQty));
}

/**
 * Unit cost including the share of freight and other costs that belongs to this line.
 * Callers allocate the order-level costs before calling; this only divides.
 */
export function landedUnitCost(receipt: CostReceipt): bigint {
  const quantity = Math.trunc(receipt.quantity);
  if (quantity <= 0) return receipt.unitCostMinor;
  const extra = receipt.landedExtraMinor ?? 0n;
  if (extra === 0n) return receipt.unitCostMinor;
  return receipt.unitCostMinor + divideRoundHalfUp(extra, BigInt(quantity));
}

/**
 * Spreads an order-level amount (freight, customs) across lines in proportion to their
 * merchandise value, giving the remainder to the largest line.
 *
 * Proportional-by-value is the convention an accountant expects, and handing the
 * rounding remainder to one line keeps the allocations summing to the original amount
 * exactly — a shortfall of three centimes in a purchase order is the kind of thing that
 * makes a reconciliation fail for a reason nobody can find.
 */
export function allocateByValue(totalMinor: bigint, lineValuesMinor: bigint[]): bigint[] {
  if (lineValuesMinor.length === 0) return [];
  if (totalMinor === 0n) return lineValuesMinor.map(() => 0n);

  const sum = lineValuesMinor.reduce((acc, value) => acc + value, 0n);
  if (sum <= 0n) {
    // No value to weigh by: split evenly and give the remainder to the first line.
    const each = totalMinor / BigInt(lineValuesMinor.length);
    const out = lineValuesMinor.map(() => each);
    out[0] = (out[0] ?? 0n) + (totalMinor - each * BigInt(lineValuesMinor.length));
    return out;
  }

  const allocations = lineValuesMinor.map((value) => (totalMinor * value) / sum);
  const remainder = totalMinor - allocations.reduce((acc, value) => acc + value, 0n);
  if (remainder !== 0n) {
    let largest = 0;
    for (let index = 1; index < lineValuesMinor.length; index += 1) {
      if ((lineValuesMinor[index] ?? 0n) > (lineValuesMinor[largest] ?? 0n)) largest = index;
    }
    allocations[largest] = (allocations[largest] ?? 0n) + remainder;
  }
  return allocations;
}

/** Purchase-order totals, so the list, the editor and the receipt agree on one figure. */
export function purchaseOrderTotals(input: {
  items: Array<{ quantity: number; unitCost: bigint }>;
  shippingCost: bigint;
  otherCost: bigint;
}): { subtotal: bigint; total: bigint; quantity: number } {
  const subtotal = input.items.reduce(
    (acc, item) => acc + item.unitCost * BigInt(Math.max(Math.trunc(item.quantity), 0)),
    0n,
  );
  return {
    subtotal,
    total: subtotal + input.shippingCost + input.otherCost,
    quantity: input.items.reduce((acc, item) => acc + Math.max(Math.trunc(item.quantity), 0), 0),
  };
}

/** Half-up division that also behaves for negative numerators. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('divideRoundHalfUp: denominator is zero');

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * The bucket a level falls in, used by both the stock overview filter and the low-stock
 * alert so the two never disagree about what "low" means.
 */
export function stockState(
  level: { onHand: number; reserved: number },
  lowStockThreshold: number,
): 'in' | 'low' | 'out' | 'negative' {
  const available = level.onHand - level.reserved;
  if (level.onHand < 0) return 'negative';
  if (available <= 0) return 'out';
  if (available <= lowStockThreshold) return 'low';
  return 'in';
}
