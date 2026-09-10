import { z } from 'zod';
import type { CallOutcome, DeliveryType, OrderSource, OrderStatus, PaymentMethod, PaymentStatus } from '../enums/index.js';
import type { Translated } from '../i18n/index.js';
import { idSchema } from './common.js';
import type { RiskFlag } from './order.js';

/**
 * The order detail an agent works from — PRD F-AD-30 to F-AD-36.
 *
 * Separate from the storefront's `TrackedOrder` on purpose: this one carries the cost,
 * the margin, the risk flags and the internal notes, none of which a customer may see.
 * Two shapes is what stops a careless join leaking a cost price onto a tracking page.
 */

export interface OrderItemDetail {
  id: string;
  variantId: string | null;
  productId: string | null;
  productName: Translated;
  productSlug: string | null;
  variantName: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceMinor: string;
  unitCostMinor: string;
  discountMinor: string;
  lineTotalMinor: string;
  refundedQuantity: number;
  returnedQuantity: number;
  /** Units of this variant available right now, so an agent can see a shortfall. */
  available: number;
}

export interface OrderEventDetail {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  kind: string;
  reason: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface OrderNoteDetail {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface CallLogDetail {
  id: string;
  outcome: CallOutcome;
  note: string | null;
  callBackAt: string | null;
  agentName: string | null;
  createdAt: string;
}

export interface OrderShipmentDetail {
  id: string;
  status: string;
  courierName: string | null;
  trackingNumber: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  source: OrderSource;

  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerAltPhone: string | null;
  customerEmail: string | null;
  /** The customer's history, so an agent can judge before they call. */
  customerOrdersCount: number;
  customerDeliveredCount: number;
  customerFailedCount: number;

  wilayaCode: number;
  wilayaName: string;
  communeName: string | null;
  deliveryType: DeliveryType;
  address: string | null;
  pickupPointName: string | null;

  currency: string;
  itemsSubtotalMinor: string;
  discountTotalMinor: string;
  loyaltyDiscountMinor: string;
  shippingTotalMinor: string;
  shippingCostMinor: string;
  taxTotalMinor: string;
  totalMinor: string;
  cogsTotalMinor: string;
  paidTotalMinor: string;
  refundedTotalMinor: string;
  /** total - cogs - shipping cost, minor units. What this order actually earned. */
  marginMinor: string;

  itemCount: number;
  weightGrams: number;
  note: string | null;
  internalNote: string | null;
  tags: string[];
  riskScore: number;
  riskFlags: RiskFlag[];
  stockReserved: boolean;
  stockDeducted: boolean;

  agentName: string | null;
  /** Statuses this order may move to right now. */
  allowedTransitions: OrderStatus[];
  editable: boolean;

  items: OrderItemDetail[];
  events: OrderEventDetail[];
  notes: OrderNoteDetail[];
  callLogs: CallLogDetail[];
  shipments: OrderShipmentDetail[];

  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

// --- writes -----------------------------------------------------------------

export const orderNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const orderTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(48)).max(20),
});

export const orderAddressPatchSchema = z.object({
  customerName: z.string().trim().min(2).max(120).optional(),
  customerPhone: z.string().trim().min(9).max(20).optional(),
  customerAltPhone: z.string().trim().max(20).nullable().optional(),
  wilayaCode: z.coerce.number().int().min(1).max(58).optional(),
  communeId: idSchema.optional(),
  address: z.string().trim().max(400).nullable().optional(),
  pickupPointId: idSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  internalNote: z.string().trim().max(4000).nullable().optional(),
});

export type OrderNoteInput = z.infer<typeof orderNoteSchema>;
export type OrderTagsInput = z.infer<typeof orderTagsSchema>;
export type OrderAddressPatchInput = z.infer<typeof orderAddressPatchSchema>;

/** Bulk actions from the list's selection bar — PRD F-AD-30. */
export const orderBulkSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
  action: z.enum(['confirm', 'pack', 'ship', 'cancel']),
  reason: z.string().trim().max(500).optional(),
});

export type OrderBulkInput = z.infer<typeof orderBulkSchema>;

export interface OrderBulkResult {
  updated: number;
  failed: Array<{ id: string; number: string; message: string }>;
}

export const ORDER_ERRORS = {
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  NOT_EDITABLE: 'NOT_EDITABLE',
  ORDER_BLOCKED: 'ORDER_BLOCKED',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  COMMUNE_MISMATCH: 'COMMUNE_MISMATCH',
  RETURN_TOO_MANY: 'RETURN_TOO_MANY',
} as const;
