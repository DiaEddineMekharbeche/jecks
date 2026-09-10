/**
 * Choosing and applying a shipping rate — PRD F-AD-60.
 *
 * Pure, because this decides what a shopper is charged and what the P&L records as the
 * cost of getting a parcel there. Both numbers have to be reproducible from the row in
 * the table, not from whatever the checkout happened to have in memory.
 */

export interface RateCandidate {
  id: string;
  /** Set when the rate names one wilaya; null when it comes from a zone. */
  wilayaCode: number | null;
  zoneId: string | null;
  courierId: string | null;
  courierActive: boolean;
  priceMinor: bigint;
  costMinor: bigint;
  freeWeightGrams: number;
  extraPerKgMinor: bigint;
  freeShippingThresholdMinor: bigint | null;
  etaMinDays: number;
  etaMaxDays: number;
  active: boolean;
}

export interface RateSelection {
  rate: RateCandidate;
  priceMinor: bigint;
  costMinor: bigint;
  freeShippingApplied: boolean;
  /** The surcharge for weight over the allowance, already inside `priceMinor`. */
  weightSurchargeMinor: bigint;
  inherited: boolean;
}

/**
 * The rate that applies, or null when the shop does not deliver there.
 *
 * A wilaya-specific rate always beats a zone rate, however cheap the zone rate is: the
 * specific row exists precisely because someone decided that wilaya is different. Among
 * equally specific rates the cheapest for the shopper wins, and a rate whose courier is
 * switched off is not a rate at all.
 */
export function selectRate(candidates: RateCandidate[]): RateCandidate | null {
  const usable = candidates.filter((rate) => rate.active && (rate.courierId === null || rate.courierActive));
  if (usable.length === 0) return null;

  const specific = usable.filter((rate) => rate.wilayaCode !== null);
  const pool = specific.length > 0 ? specific : usable;

  return [...pool].sort((a, b) => {
    if (a.priceMinor !== b.priceMinor) return a.priceMinor < b.priceMinor ? -1 : 1;
    // A tie on price goes to the cheaper one for us; the shopper cannot tell.
    if (a.costMinor !== b.costMinor) return a.costMinor < b.costMinor ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  })[0]!;
}

/**
 * Applies weight and the free-shipping threshold to a chosen rate.
 *
 * Order matters. The surcharge is computed first so the shop can see what a heavy
 * parcel costs, then the threshold zeroes the whole price — a qualifying subtotal means
 * free delivery, not free delivery plus a weight charge, which is the kind of line a
 * customer screenshots.
 *
 * Our cost never changes: the courier still charges us whatever they charge.
 */
export function applyRate(
  rate: RateCandidate,
  input: { weightGrams?: number; subtotalMinor?: bigint },
): RateSelection {
  const weightGrams = Math.max(0, Math.trunc(input.weightGrams ?? 0));
  const subtotalMinor = input.subtotalMinor ?? 0n;

  const overweightGrams = Math.max(weightGrams - rate.freeWeightGrams, 0);
  // Couriers bill a started kilo, not a fraction of one.
  const extraKilos = Math.ceil(overweightGrams / 1000);
  const weightSurchargeMinor = rate.extraPerKgMinor * BigInt(extraKilos);

  const threshold = rate.freeShippingThresholdMinor;
  const freeShippingApplied = threshold !== null && subtotalMinor >= threshold;

  return {
    rate,
    priceMinor: freeShippingApplied ? 0n : rate.priceMinor + weightSurchargeMinor,
    costMinor: rate.costMinor,
    freeShippingApplied,
    weightSurchargeMinor,
    inherited: rate.wilayaCode === null,
  };
}

/** What the shop makes on delivery. Negative is normal and worth showing. */
export function rateMargin(rate: Pick<RateCandidate, 'priceMinor' | 'costMinor'>): bigint {
  return rate.priceMinor - rate.costMinor;
}
