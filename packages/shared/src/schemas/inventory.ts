import { z } from 'zod';
import { PurchaseOrderStatus, StockMovementReason } from '../enums/index.js';
import type { Translated } from '../i18n/index.js';
import { idSchema, positiveMoneySchema } from './common.js';

/**
 * Inventory, suppliers and purchasing — PRD F-AD-50 to F-AD-53.
 *
 * Stock is never written directly. Every change goes through an operation that states a
 * reason (adjust, transfer, receive, count), and the API turns that into a signed
 * `StockMovement` with the resulting balance. That is what makes the ledger the truth
 * and the level a cache of it.
 */

// --- locations --------------------------------------------------------------

export const locationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Codes are uppercase letters, digits and hyphens'),
  address: z.string().trim().max(400).optional(),
  wilayaCode: z.coerce.number().int().min(1).max(58).optional(),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export type LocationInput = z.infer<typeof locationInputSchema>;

export interface LocationDto {
  id: string;
  name: string;
  code: string;
  address: string | null;
  wilayaCode: number | null;
  wilayaName: string | null;
  isDefault: boolean;
  active: boolean;
  /** Variants that carry a level row here, and the units they add up to. */
  variantCount: number;
  onHand: number;
}

// --- stock levels -----------------------------------------------------------

/** Buckets the stock overview filters by. "low" uses the per-product threshold. */
export const STOCK_FILTER_STATES = ['in', 'low', 'out', 'negative'] as const;
export type StockFilterState = (typeof STOCK_FILTER_STATES)[number];

export interface InventoryListFilters {
  locationId?: string[];
  state?: string[];
  categoryId?: string[];
  brandId?: string[];
  productId?: string[];
}

export interface InventoryRow {
  variantId: string;
  productId: string;
  productName: Translated;
  variantName: string | null;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  lowStockThreshold: number;
  state: StockFilterState;
  /** Minor units — cost price and its product with on-hand, so the list valuates. */
  costPriceMinor: string;
  valuationMinor: string;
  updatedAt: string;
}

export const stockAdjustSchema = z.object({
  variantId: idSchema,
  locationId: idSchema,
  /** Signed delta, or the absolute target when mode is "set". */
  quantity: z.coerce.number().int(),
  mode: z.enum(['delta', 'set']).default('delta'),
  reason: z
    .enum([
      StockMovementReason.ADJUSTMENT,
      StockMovementReason.DAMAGED,
      StockMovementReason.RETURN,
      StockMovementReason.STOCK_COUNT,
      StockMovementReason.PURCHASE,
    ])
    .default(StockMovementReason.ADJUSTMENT),
  note: z.string().trim().max(400).optional(),
});

export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;

export const stockTransferSchema = z
  .object({
    variantId: idSchema,
    fromLocationId: idSchema,
    toLocationId: idSchema,
    quantity: z.coerce.number().int().min(1),
    note: z.string().trim().max(400).optional(),
  })
  .refine((input) => input.fromLocationId !== input.toLocationId, {
    message: 'Choose two different locations',
    path: ['toLocationId'],
  });

export type StockTransferInput = z.infer<typeof stockTransferSchema>;

/** Bulk adjust from the stock overview selection bar. */
export const stockBulkAdjustSchema = z.object({
  locationId: idSchema,
  reason: stockAdjustSchema.shape.reason,
  note: z.string().trim().max(400).optional(),
  lines: z
    .array(z.object({ variantId: idSchema, quantity: z.coerce.number().int() }))
    .min(1)
    .max(500),
});

export type StockBulkAdjustInput = z.infer<typeof stockBulkAdjustSchema>;

export interface StockMovementRow {
  id: string;
  variantId: string;
  sku: string;
  productName: Translated;
  variantName: string | null;
  locationId: string;
  locationName: string;
  quantity: number;
  balanceAfter: number;
  reason: StockMovementReason;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface InventorySummary {
  /** Distinct variant and location pairs that carry a level row. */
  lines: number;
  onHand: number;
  reserved: number;
  available: number;
  lowCount: number;
  outCount: number;
  valuationMinor: string;
  retailValueMinor: string;
}

// --- suppliers --------------------------------------------------------------

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.union([z.string().trim().email().max(255), z.literal('')]).optional(),
  address: z.string().trim().max(400).optional(),
  note: z.string().trim().max(4000).optional(),
  active: z.boolean().default(true),
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

export interface SupplierRow {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  active: boolean;
  purchaseOrderCount: number;
  /** Total of every non-cancelled purchase order, minor units. */
  purchasedMinor: string;
  lastOrderAt: string | null;
  createdAt: string;
}

// --- purchase orders --------------------------------------------------------

export const purchaseOrderItemInputSchema = z.object({
  variantId: idSchema,
  quantity: z.coerce.number().int().min(1).max(100_000),
  unitCost: positiveMoneySchema,
});

export const purchaseOrderInputSchema = z.object({
  supplierId: idSchema,
  locationId: idSchema,
  expectedAt: z.coerce.date().optional(),
  shippingCost: positiveMoneySchema.default(0),
  otherCost: positiveMoneySchema.default(0),
  note: z.string().trim().max(4000).optional(),
  items: z.array(purchaseOrderItemInputSchema).min(1, 'A purchase order needs at least one line'),
});

export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;

export const purchaseOrderPatchSchema = purchaseOrderInputSchema.partial();
export type PurchaseOrderPatchInput = z.infer<typeof purchaseOrderPatchSchema>;

/**
 * Receiving is partial by default: the operator types what actually arrived, line by
 * line, and the API decides whether that closes the order or leaves it partial.
 */
export const purchaseOrderReceiveSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: idSchema,
        quantity: z.coerce.number().int().min(0).max(100_000),
        /** Overrides the ordered unit cost when the invoice differs. */
        unitCost: positiveMoneySchema.optional(),
      }),
    )
    .min(1),
  note: z.string().trim().max(400).optional(),
});

export type PurchaseOrderReceiveInput = z.infer<typeof purchaseOrderReceiveSchema>;

export interface PurchaseOrderListFilters {
  status?: string[];
  supplierId?: string[];
  locationId?: string[];
}

export interface PurchaseOrderRow {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  status: PurchaseOrderStatus;
  itemCount: number;
  quantityOrdered: number;
  quantityReceived: number;
  subtotal: string;
  shippingCost: string;
  otherCost: string;
  total: string;
  expectedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface PurchaseOrderItemDto {
  id: string;
  variantId: string;
  sku: string;
  productId: string;
  productName: Translated;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  receivedQuantity: number;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseOrderDto extends PurchaseOrderRow {
  note: string | null;
  items: PurchaseOrderItemDto[];
}

// --- stock counts -----------------------------------------------------------

export const stockCountStartSchema = z.object({
  locationId: idSchema,
  name: z.string().trim().min(1).max(120),
  /** Empty means every variant that has a level at this location. */
  variantIds: z.array(idSchema).max(5000).optional(),
  categoryId: idSchema.optional(),
  note: z.string().trim().max(4000).optional(),
});

export type StockCountStartInput = z.infer<typeof stockCountStartSchema>;

export const stockCountEntrySchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: idSchema,
        countedQuantity: z.coerce.number().int().min(0).max(1_000_000).nullable(),
      }),
    )
    .min(1)
    .max(1000),
});

export type StockCountEntryInput = z.infer<typeof stockCountEntrySchema>;

export const STOCK_COUNT_STATUSES = ['OPEN', 'APPLIED', 'CANCELLED'] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export interface StockCountItemDto {
  id: string;
  variantId: string;
  sku: string;
  productName: Translated;
  variantName: string | null;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  /** Minor units — variance times cost, so the report shows what it costs. */
  varianceValueMinor: string;
}

export interface StockCountRow {
  id: string;
  name: string;
  locationId: string;
  locationName: string;
  status: StockCountStatus;
  itemCount: number;
  countedCount: number;
  varianceUnits: number;
  varianceValueMinor: string;
  startedAt: string;
  closedAt: string | null;
}

export interface StockCountDto extends StockCountRow {
  note: string | null;
  items: StockCountItemDto[];
}

// --- error codes ------------------------------------------------------------

export const INVENTORY_ERRORS = {
  LOCATION_IN_USE: 'LOCATION_IN_USE',
  LAST_LOCATION: 'LAST_LOCATION',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  PO_NOT_EDITABLE: 'PO_NOT_EDITABLE',
  PO_NOT_RECEIVABLE: 'PO_NOT_RECEIVABLE',
  RECEIVE_OVER_ORDERED: 'RECEIVE_OVER_ORDERED',
  COUNT_CLOSED: 'COUNT_CLOSED',
  SUPPLIER_IN_USE: 'SUPPLIER_IN_USE',
} as const;
