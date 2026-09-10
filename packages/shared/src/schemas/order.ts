import { z } from 'zod';
import {
  CallOutcome,
  DeliveryFailureReason,
  DeliveryType,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  ReturnCondition,
} from '../enums/index.js';
import { dzPhoneSchema, idSchema, positiveMoneySchema } from './common.js';

/** PRD F-AD-33 — every transition goes through this, never a raw status write. */
export const orderTransitionSchema = z.object({
  to: z.nativeEnum(OrderStatus),
  reason: z.string().trim().max(500).optional(),
  failureReason: z.nativeEnum(DeliveryFailureReason).optional(),
  /** Cash handed over by the customer, in centimes, when moving to DELIVERED. */
  cashCollected: positiveMoneySchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const callLogSchema = z.object({
  outcome: z.nativeEnum(CallOutcome),
  note: z.string().trim().max(1000).optional(),
  callBackAt: z.coerce.date().optional(),
});

/** Manual order entry for phone and Instagram sales — PRD F-AD-32. */
export const manualOrderSchema = z.object({
  customer: z.object({
    id: idSchema.optional(),
    fullName: z.string().trim().min(3).max(120),
    phone: dzPhoneSchema,
    altPhone: dzPhoneSchema.optional(),
  }),
  items: z
    .array(
      z.object({
        variantId: idSchema,
        quantity: z.coerce.number().int().min(1).max(100),
        unitPriceOverride: positiveMoneySchema.optional(),
      }),
    )
    .min(1, 'Add at least one item'),
  shipping: z.object({
    wilayaCode: z.coerce.number().int().min(1).max(58),
    communeId: idSchema,
    deliveryType: z.nativeEnum(DeliveryType),
    address: z.string().trim().max(400).optional(),
    pickupPointId: idSchema.optional(),
    feeOverride: positiveMoneySchema.optional(),
  }),
  payment: z.object({ method: z.nativeEnum(PaymentMethod).default(PaymentMethod.COD) }),
  source: z.nativeEnum(OrderSource).default(OrderSource.PHONE),
  promoCode: z.string().trim().max(48).optional(),
  discountOverride: positiveMoneySchema.optional(),
  note: z.string().trim().max(1000).optional(),
});

/** Editing an unshipped order — PRD F-AD-31. */
export const editOrderItemsSchema = z.object({
  items: z.array(
    z.object({
      id: idSchema.optional(),
      variantId: idSchema,
      quantity: z.coerce.number().int().min(0).max(100),
      unitPriceOverride: positiveMoneySchema.optional(),
    }),
  ),
  reason: z.string().trim().max(500).optional(),
});

export const returnRequestSchema = z.object({
  orderId: idSchema,
  items: z
    .array(
      z.object({
        orderItemId: idSchema,
        quantity: z.coerce.number().int().min(1),
        condition: z.nativeEnum(ReturnCondition).default(ReturnCondition.RESELLABLE),
        reason: z.string().trim().max(300).optional(),
      }),
    )
    .min(1),
  restock: z.boolean().default(true),
  refundAmount: positiveMoneySchema.optional(),
  note: z.string().trim().max(1000).optional(),
});

export const orderListQuerySchema = z.object({
  status: z.array(z.nativeEnum(OrderStatus)).or(z.nativeEnum(OrderStatus)).optional(),
  q: z.string().trim().max(120).optional(),
  wilayaCode: z.coerce.number().int().min(1).max(58).optional(),
  courierId: idSchema.optional(),
  driverId: idSchema.optional(),
  agentId: idSchema.optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  source: z.nativeEnum(OrderSource).optional(),
  tag: z.string().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(['createdAt', 'total', 'number', 'status']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

/** Own-fleet dispatch — PRD F-AD-62. */
export const deliveryRunSchema = z.object({
  date: z.coerce.date(),
  driverId: idSchema,
  vehicleId: idSchema.optional(),
  orderIds: z.array(idSchema).min(1, 'Assign at least one order'),
  note: z.string().trim().max(500).optional(),
});

export const driverStopUpdateSchema = z
  .object({
    outcome: z.enum(['DELIVERED', 'FAILED']),
    cashCollected: positiveMoneySchema.optional(),
    failureReason: z.nativeEnum(DeliveryFailureReason).optional(),
    note: z.string().trim().max(500).optional(),
    proofMediaId: idSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === 'FAILED' && !value.failureReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failureReason'],
        message: 'Say why the delivery failed',
      });
    }
  });

export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>;
export type CallLogInput = z.infer<typeof callLogSchema>;
export type ManualOrderInput = z.infer<typeof manualOrderSchema>;
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type DeliveryRunInput = z.infer<typeof deliveryRunSchema>;
export type DriverStopUpdate = z.infer<typeof driverStopUpdateSchema>;

/**
 * Why an order scored the way it did — PRD F-AD-31.
 *
 * Defined here rather than in the API because the admin renders these as labels: one
 * list means a new flag cannot appear on screen as a raw enum nobody translated.
 */
export const RISK_FLAGS = [
  'BLACKLISTED',
  'FAILED_HISTORY',
  'MANY_CANCELLATIONS',
  'DUPLICATE_ORDER',
  'ORDER_FLOOD',
  'IP_FLOOD',
  'UNUSUALLY_LARGE',
  'PHONE_UNVERIFIED',
  'VAGUE_ADDRESS',
  'FIRST_ORDER',
] as const;

export type RiskFlag = (typeof RISK_FLAGS)[number];
