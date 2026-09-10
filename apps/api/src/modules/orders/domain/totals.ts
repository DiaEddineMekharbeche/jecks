/**
 * Order totals — PRD Section 7 and F-AD-70.
 *
 * The one place an order's money is computed. Both checkout and the admin's manual
 * order go through it, so a phoned-in order and a web order are priced identically;
 * two implementations would drift on the first rounding decision.
 *
 * Everything is minor units as bigint. Nothing here is ever a float.
 */

export interface TotalsLine {
  /** Cart line id, used to attribute the promo discount back. */
  id: string;
  quantity: number;
  unitPriceMinor: bigint;
  /** Cost at purchase time, frozen onto the order item for COGS. */
  unitCostMinor: bigint;
  weightGrams: number;
}

export interface TotalsInput {
  lines: TotalsLine[];
  /** Per-line discount from the promo engine, keyed by line id. */
  discountByLine: Record<string, bigint>;
  shippingMinor: bigint;
  /** Loyalty points the shopper chose to spend. */
  loyaltyPoints: number;
  /** Minor units one point is worth. */
  pointValueMinor: bigint;
  /** Cap on the share of an order loyalty may pay for, as a percentage. */
  loyaltyMaxPercent: number;
  /** VAT rate; prices already include it, so this only splits out the tax line. */
  vatPercent: number;
  pricesIncludeTax: boolean;
}

export interface OrderTotals {
  itemsSubtotalMinor: bigint;
  discountTotalMinor: bigint;
  loyaltyDiscountMinor: bigint;
  loyaltyPointsUsed: number;
  shippingTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
  cogsTotalMinor: bigint;
  itemCount: number;
  weightGrams: number;
  /** Per-line discount including the loyalty share, for the order item rows. */
  lineDiscounts: Record<string, bigint>;
}

export function computeTotals(input: TotalsInput): OrderTotals {
  const itemsSubtotal = input.lines.reduce(
    (sum, line) => sum + line.unitPriceMinor * BigInt(quantityOf(line)),
    0n,
  );

  const promoDiscount = input.lines.reduce(
    (sum, line) => sum + (input.discountByLine[line.id] ?? 0n),
    0n,
  );

  const afterPromo = itemsSubtotal - promoDiscount;

  // Loyalty is applied after promotions and capped twice: by the shop's percentage
  // ceiling, and by what is actually left to pay. Without the second cap a large
  // balance would pay for the shipping too, which is not what the ledger expects.
  const loyalty = loyaltyDiscount(
    input.loyaltyPoints,
    input.pointValueMinor,
    afterPromo,
    input.loyaltyMaxPercent,
  );

  const merchandise = afterPromo - loyalty.amountMinor;
  const total = merchandise + input.shippingMinor;

  return {
    itemsSubtotalMinor: itemsSubtotal,
    discountTotalMinor: promoDiscount,
    loyaltyDiscountMinor: loyalty.amountMinor,
    loyaltyPointsUsed: loyalty.pointsUsed,
    shippingTotalMinor: input.shippingMinor,
    taxTotalMinor: taxPortion(total, input),
    totalMinor: total,
    cogsTotalMinor: input.lines.reduce(
      (sum, line) => sum + line.unitCostMinor * BigInt(quantityOf(line)),
      0n,
    ),
    itemCount: input.lines.reduce((sum, line) => sum + quantityOf(line), 0),
    weightGrams: input.lines.reduce(
      (sum, line) => sum + line.weightGrams * quantityOf(line),
      0,
    ),
    lineDiscounts: allocateLoyalty(input, promoDiscount, loyalty.amountMinor),
  };
}

/**
 * How much of a balance may be spent, and how many points that actually costs.
 *
 * Points are only ever spent in whole units, and the shopper is never charged for more
 * than the discount they received: spending 300 points on a 250-point-worth cap must
 * deduct 250, not 300.
 */
export function loyaltyDiscount(
  points: number,
  pointValueMinor: bigint,
  payableMinor: bigint,
  maxPercent: number,
): { amountMinor: bigint; pointsUsed: number } {
  const wanted = Math.max(Math.trunc(points), 0);
  if (wanted === 0 || pointValueMinor <= 0n || payableMinor <= 0n) {
    return { amountMinor: 0n, pointsUsed: 0 };
  }

  const ceiling = (payableMinor * BigInt(Math.round(clamp(maxPercent, 0, 100) * 100))) / 10_000n;
  const requested = pointValueMinor * BigInt(wanted);
  const granted = requested > ceiling ? ceiling : requested;

  // Round the points down so the shopper is never charged for a fraction they did not
  // receive; the leftover centimes stay with the shop rather than with a phantom point.
  const pointsUsed = Number(granted / pointValueMinor);
  return { amountMinor: pointValueMinor * BigInt(pointsUsed), pointsUsed };
}

/**
 * The VAT already inside a tax-inclusive total — PRD Section 5.
 *
 * Algerian prices are quoted with VAT in them, so this does not add anything: it says
 * how much of what the customer pays is tax, which is what an invoice must show.
 */
export function taxPortion(totalMinor: bigint, input: Pick<TotalsInput, 'vatPercent' | 'pricesIncludeTax'>): bigint {
  const rate = clamp(input.vatPercent, 0, 100);
  if (rate === 0 || totalMinor <= 0n) return 0n;

  const scaled = BigInt(Math.round(rate * 100));
  if (!input.pricesIncludeTax) {
    // Exclusive pricing: the tax sits on top of the total already computed.
    return divideRoundHalfUp(totalMinor * scaled, 10_000n);
  }
  // Inclusive: total = net x (1 + rate), so tax = total x rate / (1 + rate).
  return divideRoundHalfUp(totalMinor * scaled, 10_000n + scaled);
}

/**
 * Spreads the loyalty discount over the lines on top of the promotional one.
 *
 * Same reason as the promo engine's allocation: a return has to give back the share of
 * every discount that belonged to the returned line, and a discount held at the order
 * level cannot be unwound.
 */
function allocateLoyalty(
  input: TotalsInput,
  promoDiscount: bigint,
  loyaltyMinor: bigint,
): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const line of input.lines) out[line.id] = input.discountByLine[line.id] ?? 0n;

  if (loyaltyMinor <= 0n) return out;

  const values = input.lines.map(
    (line) => line.unitPriceMinor * BigInt(quantityOf(line)) - (out[line.id] ?? 0n),
  );
  const pool = values.reduce((sum, value) => sum + value, 0n);
  if (pool <= 0n) return out;

  let allocated = 0n;
  let largest = 0;

  for (const [index, line] of input.lines.entries()) {
    const share = (loyaltyMinor * (values[index] ?? 0n)) / pool;
    out[line.id] = (out[line.id] ?? 0n) + share;
    allocated += share;
    if ((values[index] ?? 0n) > (values[largest] ?? 0n)) largest = index;
  }

  const remainder = loyaltyMinor - allocated;
  const target = input.lines[largest];
  if (remainder > 0n && target) {
    out[target.id] = (out[target.id] ?? 0n) + remainder;
  }

  // `promoDiscount` is not re-added: `out` already starts from the per-line promo
  // amounts, and adding it again would double the discount on the order items.
  void promoDiscount;
  return out;
}

function quantityOf(line: { quantity: number }): number {
  return Math.max(Math.trunc(line.quantity), 0);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const rounded = (a % b) * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
