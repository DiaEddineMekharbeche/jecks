import { z } from 'zod';
import { DeliveryType } from '../enums/index.js';
import type { Translated } from '../i18n/index.js';
import { idSchema } from './common.js';
import type { PromoRejectionCode } from './promotion.js';

/**
 * Cart — PRD F-ST-40/41.
 *
 * The browser never computes a total. It sends what the shopper did (add this variant,
 * type this code, deliver to this wilaya) and renders what comes back, because a price
 * the client calculated is a price a client can change.
 */

export const cartItemInputSchema = z.object({
  variantId: idSchema,
  quantity: z.coerce.number().int().min(1).max(99),
});

export type CartItemInput = z.infer<typeof cartItemInputSchema>;

export const cartItemPatchSchema = z.object({
  /** Zero removes the line — one code path for "remove" and "set to zero". */
  quantity: z.coerce.number().int().min(0).max(99),
});

export type CartItemPatchInput = z.infer<typeof cartItemPatchSchema>;

export const cartPromoSchema = z.object({
  code: z.string().trim().min(2).max(48).toUpperCase(),
});

export type CartPromoInput = z.infer<typeof cartPromoSchema>;

export const cartDeliverySchema = z.object({
  wilayaCode: z.coerce.number().int().min(1).max(58).nullable().optional(),
  deliveryType: z.nativeEnum(DeliveryType).nullable().optional(),
});

export type CartDeliveryInput = z.infer<typeof cartDeliverySchema>;

export interface CartItemDto {
  id: string;
  variantId: string;
  productId: string;
  productName: Translated;
  productSlug: string;
  variantName: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  /** Minor units, per unit, as snapshotted when the line was added. */
  unitPriceMinor: string;
  /** The variant's price right now; different means the price moved mid-session. */
  currentUnitPriceMinor: string;
  compareAtPriceMinor: string | null;
  lineTotalMinor: string;
  /** Share of the cart's discount that belongs to this line. */
  discountMinor: string;
  /** Units the shop can actually ship today. */
  available: number;
  /** Set when the line had to be trimmed or dropped on revalidation. */
  adjusted: 'quantity' | 'price' | 'removed' | null;
}

export interface CartPromotionDto {
  promotionId: string;
  name: string;
  code: string | null;
  amountMinor: string;
  freeShipping: boolean;
}

export interface CartRejectionDto {
  code: string;
  reason: PromoRejectionCode;
  message: string;
}

export interface CartDto {
  id: string;
  token: string;
  itemCount: number;
  items: CartItemDto[];

  currency: string;
  subtotalMinor: string;
  discountMinor: string;
  shippingMinor: string;
  totalMinor: string;
  weightGrams: number;

  wilayaCode: number | null;
  wilayaName: string | null;
  deliveryType: DeliveryType | null;
  /** Null when no wilaya is chosen yet, so the drawer knows to ask. */
  shippingQuoted: boolean;

  promotions: CartPromotionDto[];
  rejectedCodes: CartRejectionDto[];
  appliedCode: string | null;

  /** Minor units still to spend for free shipping; null when the shop offers none. */
  freeShippingThresholdMinor: string | null;
  freeShippingRemainingMinor: string | null;
  freeShipping: boolean;

  /** Lines the server changed on this read, so the UI can say why. */
  notices: string[];
  updatedAt: string;
}

export const CART_ERRORS = {
  CART_NOT_FOUND: 'CART_NOT_FOUND',
  VARIANT_UNAVAILABLE: 'VARIANT_UNAVAILABLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  CART_EMPTY: 'CART_EMPTY',
  PROMO_REJECTED: 'PROMO_REJECTED',
} as const;

/** Cookie the guest browser holds; the cart id itself never leaves the server. */
export const CART_COOKIE = 'jk_cart';
/** Days a cart survives without being touched. */
export const CART_TTL_DAYS = 30;
