import { z } from 'zod';
import { DeliveryType, OrderSource, PaymentMethod } from '../enums/index.js';
import { dzPhoneSchema, emailSchema, idSchema } from './common.js';

/**
 * Guest COD checkout — PRD F-ST-42. Deliberately minimal: name, phone, wilaya,
 * commune, delivery type. No account, no e-mail, no password.
 */
export const checkoutSchema = z
  .object({
    cartToken: z.string().min(8).max(128),
    customer: z.object({
      fullName: z.string().trim().min(3, 'Enter your full name').max(120),
      phone: dzPhoneSchema,
      altPhone: dzPhoneSchema.optional(),
      email: emailSchema.optional(),
    }),
    shipping: z.object({
      wilayaCode: z.coerce.number().int().min(1).max(58),
      communeId: idSchema,
      deliveryType: z.nativeEnum(DeliveryType),
      /** Required for HOME delivery, ignored for STOP_DESK. */
      address: z.string().trim().max(400).optional(),
      /** Required for STOP_DESK, ignored for HOME. */
      pickupPointId: idSchema.optional(),
      note: z.string().trim().max(500).optional(),
    }),
    payment: z.object({
      method: z.nativeEnum(PaymentMethod).default(PaymentMethod.COD),
    }),
    promoCode: z.string().trim().min(2).max(48).optional(),
    loyaltyPointsToRedeem: z.coerce.number().int().min(0).default(0),
    source: z.nativeEnum(OrderSource).default(OrderSource.WEB),
    utm: z
      .object({
        source: z.string().max(120).optional(),
        medium: z.string().max(120).optional(),
        campaign: z.string().max(120).optional(),
        content: z.string().max(120).optional(),
        term: z.string().max(120).optional(),
      })
      .optional(),
    /** Turnstile / hCaptcha token, demanded only after N attempts (F-ST-44). */
    captchaToken: z.string().max(4096).optional(),
    acceptsMarketing: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.shipping.deliveryType === DeliveryType.HOME) {
      if (!value.shipping.address || value.shipping.address.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shipping', 'address'],
          message: 'Home delivery needs a street address',
        });
      }
    } else if (!value.shipping.pickupPointId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shipping', 'pickupPointId'],
        message: 'Choose a pickup point',
      });
    }
  });

export const addToCartSchema = z.object({
  variantId: idSchema,
  quantity: z.coerce.number().int().min(1).max(50).default(1),
  bundleId: idSchema.optional(),
});

export const updateCartItemSchema = z.object({
  itemId: idSchema,
  quantity: z.coerce.number().int().min(0).max(50),
});

export const applyPromoSchema = z.object({
  code: z.string().trim().min(2).max(48),
});

export const shippingQuoteSchema = z.object({
  wilayaCode: z.coerce.number().int().min(1).max(58),
  deliveryType: z.nativeEnum(DeliveryType).default(DeliveryType.HOME),
  weightGrams: z.coerce.number().int().min(0).default(0),
  subtotal: z.coerce.number().int().min(0).optional(),
});

/** Public tracking without an account — PRD F-ST-52. */
export const trackOrderSchema = z.object({
  number: z.string().trim().min(4).max(32),
  phone: dzPhoneSchema,
});

export const abandonedCartPingSchema = z.object({
  cartToken: z.string().min(8).max(128),
  phone: dzPhoneSchema.optional(),
  fullName: z.string().trim().max(120).optional(),
  wilayaCode: z.coerce.number().int().min(1).max(58).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type ShippingQuoteInput = z.infer<typeof shippingQuoteSchema>;
export type TrackOrderInput = z.infer<typeof trackOrderSchema>;
