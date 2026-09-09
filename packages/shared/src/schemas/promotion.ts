import { z } from 'zod';
import { PromotionScope, PromotionType } from '../enums/index.js';
import { idSchema, positiveMoneySchema } from './common.js';

/** PRD F-AD-20 — one schema covering every promotion shape the engine supports. */
export const promotionConditionSchema = z.object({
  minSubtotal: positiveMoneySchema.optional(),
  minQuantity: z.coerce.number().int().min(1).optional(),
  productIds: z.array(idSchema).default([]),
  variantIds: z.array(idSchema).default([]),
  collectionIds: z.array(idSchema).default([]),
  categoryIds: z.array(idSchema).default([]),
  customerGroupIds: z.array(idSchema).default([]),
  wilayaCodes: z.array(z.coerce.number().int().min(1).max(58)).default([]),
  firstOrderOnly: z.boolean().default(false),
});

export const buyXGetYSchema = z.object({
  buyQuantity: z.coerce.number().int().min(1),
  getQuantity: z.coerce.number().int().min(1),
  /** 100 means the free item is free; 50 means half price on the Y items. */
  getDiscountPercent: z.coerce.number().min(0).max(100).default(100),
});

export const tierSchema = z.object({
  minSubtotal: positiveMoneySchema,
  percentOff: z.coerce.number().min(0).max(100),
});

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    type: z.nativeEnum(PromotionType),
    scope: z.nativeEnum(PromotionScope).default(PromotionScope.ORDER),
    /** null = automatic promotion with no code (F-AD-20). */
    code: z
      .string()
      .trim()
      .min(2)
      .max(48)
      .regex(/^[A-Z0-9_-]+$/, 'Codes are upper case letters, digits, dash and underscore')
      .nullable()
      .optional(),
    percentOff: z.coerce.number().min(0).max(100).optional(),
    amountOff: positiveMoneySchema.optional(),
    bundlePrice: positiveMoneySchema.optional(),
    buyXGetY: buyXGetYSchema.optional(),
    tiers: z.array(tierSchema).default([]),
    conditions: promotionConditionSchema.default({
      productIds: [],
      variantIds: [],
      collectionIds: [],
      categoryIds: [],
      customerGroupIds: [],
      wilayaCodes: [],
      firstOrderOnly: false,
    }),
    usageLimitTotal: z.coerce.number().int().min(1).nullable().optional(),
    usageLimitPerCustomer: z.coerce.number().int().min(1).nullable().optional(),
    stackable: z.boolean().default(false),
    priority: z.coerce.number().int().min(0).max(1000).default(100),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    active: z.boolean().default(true),
    showCountdown: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const need = (field: 'percentOff' | 'amountOff' | 'bundlePrice' | 'buyXGetY' | 'tiers') => {
      const present =
        field === 'tiers' ? value.tiers.length > 0 : value[field] !== undefined && value[field] !== null;
      if (!present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${value.type} promotions require ${field}`,
        });
      }
    };
    if (value.type === PromotionType.PERCENTAGE) need('percentOff');
    if (value.type === PromotionType.FIXED_AMOUNT) need('amountOff');
    if (value.type === PromotionType.BUNDLE_PRICE) need('bundlePrice');
    if (value.type === PromotionType.BUY_X_GET_Y) need('buyXGetY');
    if (value.type === PromotionType.TIERED) need('tiers');
    if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'The end date must come after the start date',
      });
    }
  });

/** Bulk unique-code generation, e.g. 500 one-time influencer codes (F-AD-20). */
export const bulkCodeSchema = z.object({
  promotionId: idSchema,
  count: z.coerce.number().int().min(1).max(5000),
  prefix: z
    .string()
    .trim()
    .max(12)
    .regex(/^[A-Z0-9]*$/)
    .default(''),
  length: z.coerce.number().int().min(4).max(16).default(8),
  usageLimitPerCode: z.coerce.number().int().min(1).default(1),
});

/** Reasons a code is refused, surfaced verbatim to the shopper — PRD F-ST-43. */
export const PROMO_REJECTIONS = {
  NOT_FOUND: 'This code does not exist',
  INACTIVE: 'This code is no longer active',
  NOT_STARTED: 'This code is not valid yet',
  EXPIRED: 'This code has expired',
  USAGE_LIMIT_REACHED: 'This code has reached its usage limit',
  CUSTOMER_LIMIT_REACHED: 'You have already used this code',
  MIN_SUBTOTAL: 'Your cart has not reached the minimum amount for this code',
  MIN_QUANTITY: 'Add more items to use this code',
  NOT_ELIGIBLE: 'This code does not apply to the items in your cart',
  WILAYA_NOT_ELIGIBLE: 'This code is not available in your wilaya',
  FIRST_ORDER_ONLY: 'This code is for first orders only',
  NOT_STACKABLE: 'This code cannot be combined with the discount already applied',
} as const;

export type PromoRejectionCode = keyof typeof PROMO_REJECTIONS;
export type PromotionInput = z.infer<typeof promotionInputSchema>;
export type PromotionCondition = z.infer<typeof promotionConditionSchema>;
export type BuyXGetY = z.infer<typeof buyXGetYSchema>;
export type PromotionTier = z.infer<typeof tierSchema>;
