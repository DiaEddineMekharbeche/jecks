import { z } from 'zod';
import type { OrderStatus } from '../enums/index.js';
import type { Translated } from '../i18n/index.js';
import { dzPhoneSchema, emailSchema, idSchema } from './common.js';

/**
 * The rest of the storefront's write surface — PRD F-ST-30 to F-ST-52.
 *
 * Everything here is reachable without a session, so every schema is also a filter
 * against abuse: lengths are capped, phone numbers are normalised to E.164 before they
 * reach the database, and nothing accepts free-form HTML.
 */

// --- wishlist ---------------------------------------------------------------

export const wishlistItemSchema = z.object({
  productId: idSchema,
  variantId: idSchema.nullable().optional(),
});

export type WishlistItemInput = z.infer<typeof wishlistItemSchema>;

export interface WishlistEntry {
  id: string;
  productId: string;
  variantId: string | null;
  productName: Translated;
  productSlug: string;
  variantName: string | null;
  imageUrl: string | null;
  priceMinor: string;
  compareAtPriceMinor: string | null;
  inStock: boolean;
  addedAt: string;
}

// --- back in stock ----------------------------------------------------------

export const notifyMeSchema = z
  .object({
    productId: idSchema,
    variantId: idSchema.nullable().optional(),
    phone: dzPhoneSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((input) => Boolean(input.phone || input.email), {
    message: 'Leave a phone number or an e-mail so we can reach you',
    path: ['phone'],
  });

export type NotifyMeInput = z.infer<typeof notifyMeSchema>;

// --- reviews ----------------------------------------------------------------

export const reviewSubmitSchema = z.object({
  productId: idSchema,
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, 'Tell us a little more').max(2000),
  authorName: z.string().trim().min(2).max(80),
  /** Used to check for a delivered order, and never published. */
  phone: dzPhoneSchema.optional(),
  email: emailSchema.optional(),
});

export type ReviewSubmitInput = z.infer<typeof reviewSubmitSchema>;

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  verified: boolean;
  reply: string | null;
  repliedAt: string | null;
  helpfulCount: number;
  createdAt: string;
}

export interface ReviewSummary {
  average: number;
  count: number;
  /** Counts per star, 1 to 5. */
  distribution: Record<string, number>;
  reviews: PublicReview[];
  total: number;
  page: number;
  pageSize: number;
}

// --- newsletter and contact -------------------------------------------------

export const newsletterSchema = z
  .object({
    email: emailSchema.optional(),
    phone: dzPhoneSchema.optional(),
    locale: z.enum(['fr', 'ar', 'en']).default('fr'),
    source: z.string().trim().max(48).optional(),
  })
  .refine((input) => Boolean(input.email || input.phone), {
    message: 'Enter an e-mail address or a phone number',
    path: ['email'],
  });

export type NewsletterInput = z.infer<typeof newsletterSchema>;

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema.optional(),
  phone: dzPhoneSchema.optional(),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(10).max(4000),
});

export type ContactInput = z.infer<typeof contactSchema>;

// --- analytics --------------------------------------------------------------

export const ANALYTICS_EVENT_NAMES = [
  'page_view',
  'product_view',
  'collection_view',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'checkout_start',
  'checkout_step',
  'purchase',
  'wishlist_add',
] as const;

export const analyticsEventSchema = z.object({
  name: z.enum(ANALYTICS_EVENT_NAMES),
  /** Random per browser session; never a customer identifier. */
  sessionId: z.string().trim().min(8).max(64),
  productId: idSchema.optional(),
  variantId: idSchema.optional(),
  orderId: idSchema.optional(),
  path: z.string().trim().max(400).optional(),
  referrer: z.string().trim().max(400).optional(),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(120).optional(),
  query: z.string().trim().max(200).optional(),
  resultCount: z.coerce.number().int().min(0).max(100_000).optional(),
  valueMinor: z.coerce.number().int().min(0).optional(),
  device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  wilayaCode: z.coerce.number().int().min(1).max(58).optional(),
  occurredAt: z.coerce.date().optional(),
});

/** Batched: a page emits several events and posts them in one request on unload. */
export const analyticsBatchSchema = z.object({
  events: z.array(analyticsEventSchema).min(1).max(50),
});

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;
export type AnalyticsBatchInput = z.infer<typeof analyticsBatchSchema>;

// --- account ----------------------------------------------------------------

export const addressInputSchema = z.object({
  label: z.string().trim().max(48).optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: dzPhoneSchema,
  altPhone: dzPhoneSchema.optional(),
  wilayaCode: z.coerce.number().int().min(1).max(58),
  communeId: idSchema,
  address: z.string().trim().min(5).max(400),
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.infer<typeof addressInputSchema>;

export interface AddressDto {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  altPhone: string | null;
  wilayaCode: number;
  wilayaName: string;
  communeId: string | null;
  communeName: string | null;
  address: string;
  isDefault: boolean;
}

export interface AccountProfile {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  locale: string;
  loyaltyPoints: number;
  /** Minor units the balance is worth at today's redemption rate. */
  loyaltyValueMinor: string;
  ordersCount: number;
  deliveredCount: number;
  lifetimeValueMinor: string;
  acceptsMarketing: boolean;
  memberSince: string;
}

export interface LoyaltyEntry {
  id: string;
  points: number;
  kind: string;
  note: string | null;
  balanceAfter: number;
  orderNumber: string | null;
  createdAt: string;
}

// --- order tracking ---------------------------------------------------------

export const trackOrderSchema = z.object({
  number: z.string().trim().min(4).max(32).toUpperCase(),
  phone: dzPhoneSchema,
});

export type TrackOrderInput = z.infer<typeof trackOrderSchema>;

export interface TrackedOrderEvent {
  status: OrderStatus;
  at: string;
  note: string | null;
}

export interface TrackedOrder {
  number: string;
  status: OrderStatus;
  placedAt: string;
  /** Only what the shopper needs; never the internal notes or the risk score. */
  itemCount: number;
  totalMinor: string;
  currency: string;
  wilayaName: string;
  communeName: string | null;
  deliveryType: string;
  courierName: string | null;
  trackingNumber: string | null;
  estimatedDelivery: { minDays: number; maxDays: number } | null;
  timeline: TrackedOrderEvent[];
  items: Array<{
    productName: Translated;
    variantName: string | null;
    quantity: number;
    unitPriceMinor: string;
    imageUrl: string | null;
  }>;
}

export const STOREFRONT_ERRORS = {
  ALREADY_SUBSCRIBED: 'ALREADY_SUBSCRIBED',
  REVIEW_DUPLICATE: 'REVIEW_DUPLICATE',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  NOT_A_CUSTOMER: 'NOT_A_CUSTOMER',
} as const;
