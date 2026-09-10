import { z } from 'zod';
import { CustomerSegment } from '../enums/index.js';
import type { Translated } from '../i18n/index.js';
import { dzPhoneSchema, idSchema, translatedSchema } from './common.js';

/**
 * Customers as the back office sees them — PRD F-AD-40 to F-AD-42.
 *
 * The phone number is the identity (PRD Section 3), which is why merging duplicates
 * exists at all: the same person orders from two numbers, and the shop needs one
 * history rather than two half-histories.
 */

// --- list -------------------------------------------------------------------

export interface CustomerListFilters {
  segment?: string[];
  groupId?: string[];
  wilayaCode?: string[];
  blacklisted?: string[];
}

export interface CustomerRow {
  id: string;
  phone: string;
  fullName: string;
  email: string | null;
  segment: CustomerSegment;
  groupName: Translated | null;
  ordersCount: number;
  deliveredCount: number;
  failedCount: number;
  lifetimeValueMinor: string;
  averageOrderMinor: string;
  /** Delivered against attempted, as a percentage; null when never attempted. */
  reliability: number | null;
  loyaltyPoints: number;
  blacklisted: boolean;
  acceptsMarketing: boolean;
  lastOrderAt: string | null;
  createdAt: string;
}

export interface CustomerDetail extends CustomerRow {
  altPhone: string | null;
  locale: string;
  blacklistReason: string | null;
  groupId: string | null;
  firstOrderAt: string | null;
  cancelledCount: number;
  /** Days between orders, over their own history; null before a second order. */
  averageDaysBetweenOrders: number | null;
  overdue: boolean;
  addresses: Array<{
    id: string;
    label: string | null;
    address: string;
    communeName: string | null;
    wilayaName: string;
    isDefault: boolean;
  }>;
  orders: Array<{
    id: string;
    number: string;
    status: string;
    totalMinor: string;
    itemCount: number;
    createdAt: string;
  }>;
  notes: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
  loyalty: Array<{
    id: string;
    points: number;
    kind: string;
    balanceAfter: number;
    note: string | null;
    createdAt: string;
  }>;
  consents: { acceptsMarketing: boolean; updatedAt: string };
}

// --- editing ----------------------------------------------------------------

export const customerPatchSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  altPhone: z.string().trim().max(20).nullable().optional(),
  locale: z.enum(['fr', 'ar', 'en']).optional(),
  groupId: idSchema.nullable().optional(),
  acceptsMarketing: z.boolean().optional(),
});

export type CustomerPatchInput = z.infer<typeof customerPatchSchema>;

export const customerNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export type CustomerNoteInput = z.infer<typeof customerNoteSchema>;

export const blacklistSchema = z
  .object({
    blacklisted: z.boolean(),
    reason: z.string().trim().max(255).nullable().optional(),
  })
  .refine((input) => !input.blacklisted || Boolean(input.reason?.trim()), {
    message: 'Say why this customer is being blocked',
    path: ['reason'],
  });

export type BlacklistInput = z.infer<typeof blacklistSchema>;

/**
 * Merging two records of the same person.
 *
 * The survivor keeps the identity; everything the other has is moved across. It is
 * deliberately explicit about which is which, because the operation cannot be undone.
 */
export const customerMergeSchema = z
  .object({
    keepId: idSchema,
    mergeId: idSchema,
  })
  .refine((input) => input.keepId !== input.mergeId, {
    message: 'A customer cannot be merged into themselves',
    path: ['mergeId'],
  });

export type CustomerMergeInput = z.infer<typeof customerMergeSchema>;

export interface MergePreview {
  keep: { id: string; phone: string; fullName: string; ordersCount: number };
  merge: { id: string; phone: string; fullName: string; ordersCount: number };
  /** What will move, so the operator can see the size of it before agreeing. */
  moves: { orders: number; addresses: number; notes: number; reviews: number; loyaltyPoints: number };
}

// --- loyalty ----------------------------------------------------------------

export const loyaltyAdjustSchema = z
  .object({
    points: z.coerce.number().int().min(-100_000).max(100_000),
    note: z.string().trim().min(1).max(300),
  })
  .refine((input) => input.points !== 0, {
    message: 'An adjustment of zero points changes nothing',
    path: ['points'],
  });

export type LoyaltyAdjustInput = z.infer<typeof loyaltyAdjustSchema>;

// --- groups -----------------------------------------------------------------

export const customerGroupInputSchema = z.object({
  name: translatedSchema,
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase words joined by hyphens'),
  discountPercent: z.coerce.number().min(0).max(90).default(0),
});

export type CustomerGroupInput = z.infer<typeof customerGroupInputSchema>;

export interface CustomerGroupDto {
  id: string;
  name: Translated;
  slug: string;
  discountPercent: number;
  customerCount: number;
}

// --- segments ---------------------------------------------------------------

export interface SegmentSummary {
  segment: CustomerSegment;
  count: number;
  lifetimeValueMinor: string;
  averageOrderMinor: string;
}

/** Adding a phone by hand, for an order taken over the counter. */
export const customerCreateSchema = z.object({
  phone: dzPhoneSchema,
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255).nullable().optional(),
  groupId: idSchema.nullable().optional(),
  acceptsMarketing: z.boolean().default(false),
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const CUSTOMER_ERRORS = {
  PHONE_TAKEN: 'PHONE_TAKEN',
  GROUP_IN_USE: 'GROUP_IN_USE',
  MERGE_BLACKLISTED: 'MERGE_BLACKLISTED',
  INSUFFICIENT_POINTS: 'INSUFFICIENT_POINTS',
} as const;

export type CustomerErrorCode = (typeof CUSTOMER_ERRORS)[keyof typeof CUSTOMER_ERRORS];
