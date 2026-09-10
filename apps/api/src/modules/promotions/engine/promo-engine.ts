import {
  PROMO_REJECTIONS,
  PromotionScope,
  PromotionType,
  type PromoRejectionCode,
} from '@jecks/shared';
import type {
  AppliedPromotion,
  CartLine,
  LineDiscount,
  PromoContext,
  PromoResult,
  PromoRule,
  RejectedPromotion,
} from './types.js';

/**
 * The promotion engine — PRD F-AD-20/21, F-ST-43.
 *
 * Pure: same input, same output, no clock of its own and no database. Everything it
 * needs is in the context, which is what lets the whole discount surface be covered by
 * a table of cases rather than by hoping.
 *
 * Three rules decide almost everything it does:
 *
 * 1. **Money is bigint minor units and rounding is half-up, once, per line.** A
 *    percentage is applied to a line total, never to a unit price that is then
 *    multiplied, because the second form loses a centime per unit and the cart stops
 *    adding up.
 * 2. **A discount can never exceed what is left to discount.** Every application is
 *    clamped against the line's remaining value, so two stacked promotions cannot take
 *    a line below zero and turn a cart into a refund.
 * 3. **Priority decides, and the first non-stackable one closes the door.** Rules are
 *    sorted by priority then by discount value; once a non-stackable one applies,
 *    everything after it is rejected with a reason the shopper can read.
 */

export function applyPromotions(context: PromoContext, rules: PromoRule[]): PromoResult {
  const subtotal = subtotalOf(context.lines);
  const applied: AppliedPromotion[] = [];
  const rejected: RejectedPromotion[] = [];

  // Remaining discountable value per line. Every application draws from this, which is
  // what makes stacking safe without any promotion knowing about the others.
  const remaining = new Map<string, bigint>(
    context.lines.map((line) => [line.id, line.excluded ? 0n : lineTotal(line)]),
  );

  let freeShipping = false;
  let blockedByExclusive = false;

  for (const rule of sortRules(rules, context)) {
    const label = rule.code ?? rule.name;

    if (blockedByExclusive) {
      rejected.push(reject(label, rule.id, 'NOT_STACKABLE'));
      continue;
    }

    const reason = eligibility(rule, context, subtotal);
    if (reason) {
      rejected.push(reject(label, rule.id, reason));
      continue;
    }

    const outcome = grant(rule, context, remaining);

    // A rule that qualifies but grants nothing — a percentage on lines already reduced
    // to zero — is a rejection, not a silent no-op: the shopper typed a code and is
    // owed an explanation.
    if (outcome.amountMinor === 0n && !outcome.freeShipping) {
      rejected.push(reject(label, rule.id, 'NOT_ELIGIBLE'));
      continue;
    }

    for (const discount of outcome.lineDiscounts) {
      remaining.set(discount.lineId, (remaining.get(discount.lineId) ?? 0n) - discount.amountMinor);
    }

    applied.push({
      promotionId: rule.id,
      promoCodeId: rule.promoCodeId ?? null,
      name: rule.name,
      code: rule.code,
      type: rule.type,
      scope: rule.scope,
      amountMinor: outcome.amountMinor,
      freeShipping: outcome.freeShipping,
      lineDiscounts: outcome.lineDiscounts,
    });

    if (outcome.freeShipping) freeShipping = true;
    if (!rule.stackable) blockedByExclusive = true;
  }

  // A typed code that matched no rule at all still deserves an answer.
  for (const code of context.codes) {
    const known =
      applied.some((entry) => entry.code === code) || rejected.some((entry) => entry.code === code);
    if (!known) rejected.push(reject(code, null, 'NOT_FOUND'));
  }

  const lineDiscounts = mergeLineDiscounts(applied);
  const discount = lineDiscounts.reduce((sum, entry) => sum + entry.amountMinor, 0n);
  const shipping = freeShipping ? 0n : context.shippingMinor;

  return {
    applied,
    rejected,
    lineDiscounts,
    discountMinor: discount,
    freeShipping,
    shippingMinor: shipping,
    subtotalMinor: subtotal,
    totalMinor: subtotal - discount + shipping,
  };
}

// --- ordering ---------------------------------------------------------------

/**
 * Highest priority first; ties broken by the larger discount, so a shopper who could
 * have either of two exclusive offers gets the better one.
 *
 * The tie-break estimates each rule's value against the untouched cart. That is not the
 * value it would have after another rule applied, but the comparison only ever runs
 * between rules of equal priority, where none has applied yet.
 */
function sortRules(rules: PromoRule[], context: PromoContext): PromoRule[] {
  const estimate = new Map<string, bigint>();
  for (const rule of rules) {
    const clean = new Map<string, bigint>(
      context.lines.map((line) => [line.id, line.excluded ? 0n : lineTotal(line)]),
    );
    estimate.set(rule.id, grant(rule, context, clean).amountMinor);
  }

  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const valueA = estimate.get(a.id) ?? 0n;
    const valueB = estimate.get(b.id) ?? 0n;
    if (valueA !== valueB) return valueA > valueB ? -1 : 1;
    // Last resort: a stable order so the same cart always yields the same answer.
    return a.id.localeCompare(b.id);
  });
}

// --- eligibility ------------------------------------------------------------

function eligibility(
  rule: PromoRule,
  context: PromoContext,
  subtotal: bigint,
): PromoRejectionCode | null {
  if (!rule.active) return 'INACTIVE';
  if (rule.startsAt && context.now < rule.startsAt) return 'NOT_STARTED';
  if (rule.endsAt && context.now > rule.endsAt) return 'EXPIRED';

  if (rule.usageLimitTotal !== null && rule.usageCount >= rule.usageLimitTotal) {
    return 'USAGE_LIMIT_REACHED';
  }
  if (rule.codeUsesRemaining !== undefined && rule.codeUsesRemaining !== null && rule.codeUsesRemaining <= 0) {
    return 'USAGE_LIMIT_REACHED';
  }
  if (rule.usageLimitPerCustomer !== null) {
    const used = context.customer.usageByPromotion[rule.id] ?? 0;
    if (used >= rule.usageLimitPerCustomer) return 'CUSTOMER_LIMIT_REACHED';
  }

  if (rule.firstOrderOnly && context.customer.orderCount > 0) return 'FIRST_ORDER_ONLY';

  if (rule.customerGroupIds.length > 0) {
    if (!context.customer.groupId || !rule.customerGroupIds.includes(context.customer.groupId)) {
      return 'NOT_ELIGIBLE';
    }
  }

  if (rule.wilayaCodes.length > 0) {
    if (context.wilayaCode === null || !rule.wilayaCodes.includes(context.wilayaCode)) {
      return 'WILAYA_NOT_ELIGIBLE';
    }
  }

  // Presence is judged on the whole cart, including lines that may not themselves be
  // discounted: "is there a cap in this basket" is a different question from "which
  // lines may I take money off".
  if (scopedLines(rule, context.lines, true).length === 0) return 'NOT_ELIGIBLE';

  // Thresholds, by contrast, are measured on the discountable lines the promotion
  // covers: "3 000 DA of caps" must not be satisfied by 3 000 DA of jackets, nor by a
  // gift line that was excluded from discounting in the first place.
  const scoped = scopedLines(rule, context.lines);
  const scopedSubtotal = isTargeted(rule) ? subtotalOf(scoped) : subtotal;
  if (rule.minSubtotalMinor !== null && scopedSubtotal < rule.minSubtotalMinor) return 'MIN_SUBTOTAL';

  if (rule.minQuantity !== null) {
    const quantity = scoped.reduce((sum, line) => sum + line.quantity, 0);
    if (quantity < rule.minQuantity) return 'MIN_QUANTITY';
  }

  return null;
}

/** True when the rule names specific products, variants, collections or categories. */
function isTargeted(rule: PromoRule): boolean {
  return (
    rule.productIds.length > 0 ||
    rule.variantIds.length > 0 ||
    rule.collectionIds.length > 0 ||
    rule.categoryIds.length > 0
  );
}

/**
 * The lines a rule covers: every line when it names nothing.
 *
 * `includeExcluded` separates "is this in the cart" from "may I discount this". Only
 * the eligibility check asks the first question; everything that grants money asks the
 * second.
 */
function scopedLines(rule: PromoRule, lines: CartLine[], includeExcluded = false): CartLine[] {
  const eligible = lines.filter(
    (line) => line.quantity > 0 && (includeExcluded || !line.excluded),
  );
  if (!isTargeted(rule)) return eligible;

  return eligible.filter(
    (line) =>
      rule.variantIds.includes(line.variantId) ||
      rule.productIds.includes(line.productId) ||
      (line.categoryId !== null && rule.categoryIds.includes(line.categoryId)) ||
      line.collectionIds.some((id) => rule.collectionIds.includes(id)),
  );
}

// --- granting ---------------------------------------------------------------

interface Grant {
  amountMinor: bigint;
  freeShipping: boolean;
  lineDiscounts: LineDiscount[];
}

function grant(
  rule: PromoRule,
  context: PromoContext,
  remaining: Map<string, bigint>,
): Grant {
  const lines = scopedLines(rule, context.lines).filter(
    (line) => (remaining.get(line.id) ?? 0n) > 0n,
  );

  switch (rule.type) {
    case PromotionType.FREE_SHIPPING:
      // Shipping-scope promotions grant nothing on the merchandise by design.
      return { amountMinor: 0n, freeShipping: true, lineDiscounts: [] };

    case PromotionType.PERCENTAGE:
      return percentageGrant(lines, remaining, rule.percentOff ?? 0);

    case PromotionType.FIXED_AMOUNT:
      return fixedGrant(lines, remaining, rule.amountOffMinor ?? 0n);

    case PromotionType.TIERED:
      return tieredGrant(rule, lines, remaining);

    case PromotionType.BUY_X_GET_Y:
      return buyXGetYGrant(rule, lines, remaining);

    case PromotionType.BUNDLE_PRICE:
      return bundleGrant(rule, lines, remaining);

    default:
      return { amountMinor: 0n, freeShipping: false, lineDiscounts: [] };
  }
}

function percentageGrant(
  lines: CartLine[],
  remaining: Map<string, bigint>,
  percent: number,
): Grant {
  if (percent <= 0) return empty();

  const lineDiscounts: LineDiscount[] = [];
  let total = 0n;

  for (const line of lines) {
    const left = remaining.get(line.id) ?? 0n;
    // Percent arrives as a decimal with up to two places; scaling by 100 first keeps
    // 7.5 % exact rather than turning it into floating point.
    const amount = clamp(divideRoundHalfUp(left * BigInt(Math.round(percent * 100)), 10_000n), left);
    if (amount <= 0n) continue;
    lineDiscounts.push({ lineId: line.id, amountMinor: amount });
    total += amount;
  }

  return { amountMinor: total, freeShipping: false, lineDiscounts };
}

/**
 * A flat amount off, spread across the covered lines in proportion to their value.
 *
 * Spreading matters because a return of one line has to give back the share of the
 * discount that belonged to it; a discount parked on the order as a whole cannot be
 * unwound line by line.
 */
function fixedGrant(
  lines: CartLine[],
  remaining: Map<string, bigint>,
  amountOff: bigint,
): Grant {
  if (amountOff <= 0n || lines.length === 0) return empty();

  const values = lines.map((line) => remaining.get(line.id) ?? 0n);
  const pool = values.reduce((sum, value) => sum + value, 0n);
  if (pool <= 0n) return empty();

  const budget = amountOff > pool ? pool : amountOff;
  const lineDiscounts: LineDiscount[] = [];
  let allocated = 0n;

  for (const [index, line] of lines.entries()) {
    const share = (budget * (values[index] ?? 0n)) / pool;
    if (share <= 0n) continue;
    lineDiscounts.push({ lineId: line.id, amountMinor: share });
    allocated += share;
  }

  // The rounding remainder goes to the largest line, so the total taken off is exactly
  // the amount promised rather than a centime or two short.
  const shortfall = budget - allocated;
  if (shortfall > 0n) {
    const target = largestIndex(values);
    const line = lines[target];
    if (line) {
      const existing = lineDiscounts.find((entry) => entry.lineId === line.id);
      const headroom = (values[target] ?? 0n) - (existing?.amountMinor ?? 0n);
      const extra = shortfall > headroom ? headroom : shortfall;
      if (extra > 0n) {
        if (existing) existing.amountMinor += extra;
        else lineDiscounts.push({ lineId: line.id, amountMinor: extra });
        allocated += extra;
      }
    }
  }

  return { amountMinor: allocated, freeShipping: false, lineDiscounts };
}

/** The highest tier the cart has reached, applied as a percentage. */
function tieredGrant(rule: PromoRule, lines: CartLine[], remaining: Map<string, bigint>): Grant {
  const value = lines.reduce((sum, line) => sum + (remaining.get(line.id) ?? 0n), 0n);

  const reached = [...rule.tiers]
    .filter((tier) => value >= tier.minSubtotalMinor)
    .sort((a, b) => (a.minSubtotalMinor > b.minSubtotalMinor ? -1 : 1))[0];

  if (!reached) return empty();
  return percentageGrant(lines, remaining, reached.percentOff);
}

/**
 * Buy X get Y — PRD F-AD-20.
 *
 * The discounted units are the cheapest in the qualifying set, which is the convention
 * shoppers expect from "buy two get one free" and the one that does not let a cart of
 * one expensive and two cheap items claim the expensive one free.
 *
 * Quantities are expanded into individual units because a line of three at 1 000 DA can
 * have one unit discounted and two not, and a per-line model cannot express that.
 */
function buyXGetYGrant(rule: PromoRule, lines: CartLine[], remaining: Map<string, bigint>): Grant {
  const offer = rule.buyXGetY;
  if (!offer || offer.buyQuantity <= 0 || offer.getQuantity <= 0) return empty();

  const units: Array<{ lineId: string; priceMinor: bigint }> = [];
  for (const line of lines) {
    const left = remaining.get(line.id) ?? 0n;
    if (left <= 0n) continue;
    // Effective unit price after anything already taken off this line, so a stacked
    // promotion cannot give away more than the unit is still worth.
    const unit = divideRoundHalfUp(left, BigInt(line.quantity));
    for (let index = 0; index < line.quantity; index += 1) {
      units.push({ lineId: line.id, priceMinor: unit });
    }
  }

  const groupSize = offer.buyQuantity + offer.getQuantity;
  const groups = Math.floor(units.length / groupSize);
  if (groups === 0) return empty();

  const cheapestFirst = [...units].sort((a, b) => (a.priceMinor < b.priceMinor ? -1 : 1));
  const freeUnits = cheapestFirst.slice(0, groups * offer.getQuantity);

  const byLine = new Map<string, bigint>();

  for (const unit of freeUnits) {
    const off = divideRoundHalfUp(
      unit.priceMinor * BigInt(Math.round(offer.getDiscountPercent * 100)),
      10_000n,
    );
    if (off <= 0n) continue;
    byLine.set(unit.lineId, (byLine.get(unit.lineId) ?? 0n) + off);
  }

  const lineDiscounts: LineDiscount[] = [];
  for (const [lineId, amount] of byLine) {
    const capped = clamp(amount, remaining.get(lineId) ?? 0n);
    if (capped <= 0n) continue;
    lineDiscounts.push({ lineId, amountMinor: capped });
  }

  return {
    amountMinor: lineDiscounts.reduce((sum, entry) => sum + entry.amountMinor, 0n),
    freeShipping: false,
    lineDiscounts,
  };
}

/** "These items together for 4 900 DA": the difference is the discount. */
function bundleGrant(rule: PromoRule, lines: CartLine[], remaining: Map<string, bigint>): Grant {
  const price = rule.bundlePriceMinor;
  if (price === null || price === undefined) return empty();

  const value = lines.reduce((sum, line) => sum + (remaining.get(line.id) ?? 0n), 0n);
  if (value <= price) return empty();

  return fixedGrant(lines, remaining, value - price);
}

// --- helpers ----------------------------------------------------------------

function empty(): Grant {
  return { amountMinor: 0n, freeShipping: false, lineDiscounts: [] };
}

function reject(
  code: string,
  promotionId: string | null,
  reason: PromoRejectionCode,
): RejectedPromotion {
  return { code, promotionId, reason, message: PROMO_REJECTIONS[reason] };
}

function mergeLineDiscounts(applied: AppliedPromotion[]): LineDiscount[] {
  const byLine = new Map<string, bigint>();
  for (const promotion of applied) {
    for (const discount of promotion.lineDiscounts) {
      byLine.set(discount.lineId, (byLine.get(discount.lineId) ?? 0n) + discount.amountMinor);
    }
  }
  return [...byLine.entries()].map(([lineId, amountMinor]) => ({ lineId, amountMinor }));
}

export function lineTotal(line: CartLine): bigint {
  return line.unitPriceMinor * BigInt(Math.max(line.quantity, 0));
}

export function subtotalOf(lines: CartLine[]): bigint {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0n);
}

function clamp(amount: bigint, ceiling: bigint): bigint {
  if (amount < 0n) return 0n;
  return amount > ceiling ? ceiling : amount;
}

function largestIndex(values: bigint[]): number {
  let index = 0;
  for (let position = 1; position < values.length; position += 1) {
    if ((values[position] ?? 0n) > (values[index] ?? 0n)) index = position;
  }
  return index;
}

/** Half-up so a 7,5 % discount on 199,90 DA rounds the way an invoice would. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const rounded = (a % b) * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export { PromotionScope, PromotionType };
