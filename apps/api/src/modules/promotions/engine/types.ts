import type { PromotionScope, PromotionType, PromoRejectionCode } from '@jecks/shared';

/**
 * The promo engine's contract — PRD F-AD-20/21 and F-ST-43.
 *
 * Everything the engine needs arrives in `PromoContext`; nothing is fetched from inside
 * it. That is what makes the whole discount calculation a pure function of its input,
 * and therefore a thing that can be proved right in a table-driven test instead of
 * argued about against a database.
 */

export interface CartLine {
  /** Stable id used to attribute per-line discounts back to the cart. */
  id: string;
  variantId: string;
  productId: string;
  categoryId: string | null;
  collectionIds: string[];
  quantity: number;
  /** Minor units, per unit, before any promotion. */
  unitPriceMinor: bigint;
  /** Excluded from discounts and from BxGy counting — a gift line, say. */
  excluded?: boolean;
}

export interface PromoCustomer {
  id: string | null;
  groupId: string | null;
  /** Completed orders; zero makes `firstOrderOnly` promotions eligible. */
  orderCount: number;
  /** Times this customer has already used each promotion, keyed by promotion id. */
  usageByPromotion: Record<string, number>;
}

export interface PromoContext {
  lines: CartLine[];
  customer: PromoCustomer;
  wilayaCode: number | null;
  /** Codes the shopper typed, upper-cased. Automatic promotions need none. */
  codes: string[];
  /** Shipping as quoted before any promotion, minor units. */
  shippingMinor: bigint;
  now: Date;
}

/** A promotion flattened out of the database into what the engine actually reads. */
export interface PromoRule {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  /** null for an automatic promotion. */
  code: string | null;
  /** Set when the shopper's code was one of the bulk unique codes. */
  promoCodeId?: string | null;

  percentOff: number | null;
  amountOffMinor: bigint | null;
  bundlePriceMinor: bigint | null;
  buyXGetY: { buyQuantity: number; getQuantity: number; getDiscountPercent: number } | null;
  tiers: Array<{ minSubtotalMinor: bigint; percentOff: number }>;

  minSubtotalMinor: bigint | null;
  minQuantity: number | null;
  firstOrderOnly: boolean;
  wilayaCodes: number[];

  productIds: string[];
  variantIds: string[];
  collectionIds: string[];
  categoryIds: string[];
  customerGroupIds: string[];

  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  usageCount: number;
  /** Remaining uses on the specific unique code, when one was supplied. */
  codeUsesRemaining?: number | null;

  stackable: boolean;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
}

export interface LineDiscount {
  lineId: string;
  /** Minor units taken off the whole line, not per unit. */
  amountMinor: bigint;
}

export interface AppliedPromotion {
  promotionId: string;
  promoCodeId: string | null;
  name: string;
  code: string | null;
  type: PromotionType;
  scope: PromotionScope;
  /** Total discount this promotion granted, minor units. */
  amountMinor: bigint;
  freeShipping: boolean;
  lineDiscounts: LineDiscount[];
}

export interface RejectedPromotion {
  /** The code the shopper typed, or the promotion name for an automatic one. */
  code: string;
  promotionId: string | null;
  reason: PromoRejectionCode;
  message: string;
}

export interface PromoResult {
  applied: AppliedPromotion[];
  rejected: RejectedPromotion[];
  /** Per line, summed across every applied promotion. */
  lineDiscounts: LineDiscount[];
  /** Total taken off the merchandise, minor units. */
  discountMinor: bigint;
  freeShipping: boolean;
  /** Shipping after any free-shipping promotion, minor units. */
  shippingMinor: bigint;
  subtotalMinor: bigint;
  /** subtotal - discount + shipping, floored at the shipping cost. */
  totalMinor: bigint;
}
