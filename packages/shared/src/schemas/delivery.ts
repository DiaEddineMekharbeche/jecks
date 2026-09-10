import { z } from 'zod';
import {
  DeliveryFailureReason,
  DeliveryType,
  ShipmentStatus,
} from '../enums/index.js';
import type { Translated } from '../i18n/index.js';
import { dzPhoneSchema, idSchema, positiveMoneySchema, translatedSchema } from './common.js';

/**
 * Delivery, the fleet and cash on delivery — PRD F-AD-60 to F-AD-65.
 *
 * Two things run in parallel here and must never be confused. A *shipment* is a parcel
 * handed to a courier, tracked by their number and settled against their statement. A
 * *run* is our own driver's day, ordered by distance and settled in cash at the office.
 * An order takes one road or the other, never both.
 */

// --- zones ------------------------------------------------------------------

export const shippingZoneInputSchema = z.object({
  name: translatedSchema,
  wilayaCodes: z.array(z.coerce.number().int().min(1).max(58)).min(1).max(58),
  position: z.coerce.number().int().min(0).max(999).default(0),
});

export type ShippingZoneInput = z.infer<typeof shippingZoneInputSchema>;

export interface ShippingZoneDto {
  id: string;
  name: Translated;
  wilayaCodes: number[];
  position: number;
  rateCount: number;
}

// --- rates ------------------------------------------------------------------

export const shippingRateInputSchema = z
  .object({
    zoneId: idSchema.nullable().optional(),
    wilayaCode: z.coerce.number().int().min(1).max(58).nullable().optional(),
    courierId: idSchema.nullable().optional(),
    deliveryType: z.nativeEnum(DeliveryType).default(DeliveryType.HOME),
    price: positiveMoneySchema,
    cost: positiveMoneySchema.default(0),
    freeWeightGrams: z.coerce.number().int().min(0).max(100_000).default(1000),
    extraPerKg: positiveMoneySchema.default(0),
    freeShippingThreshold: positiveMoneySchema.nullable().optional(),
    etaMinDays: z.coerce.number().int().min(0).max(60).default(1),
    etaMaxDays: z.coerce.number().int().min(0).max(60).default(4),
    active: z.boolean().default(true),
  })
  .refine((rate) => rate.zoneId != null || rate.wilayaCode != null, {
    message: 'A rate covers either one wilaya or a zone',
    path: ['wilayaCode'],
  })
  .refine((rate) => rate.etaMaxDays >= rate.etaMinDays, {
    message: 'The longest estimate cannot be shorter than the shortest',
    path: ['etaMaxDays'],
  });

export type ShippingRateInput = z.infer<typeof shippingRateInputSchema>;

/**
 * The matrix editor writes many cells at once.
 *
 * Sending them one request at a time turns a routine price change across 58 wilayas
 * into 116 round trips, and leaves the table half-updated if one of them fails.
 */
export const shippingRateBulkSchema = z.object({
  cells: z
    .array(
      z.object({
        wilayaCode: z.coerce.number().int().min(1).max(58),
        deliveryType: z.nativeEnum(DeliveryType),
        courierId: idSchema.nullable().optional(),
        price: positiveMoneySchema,
        cost: positiveMoneySchema.optional(),
        active: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export type ShippingRateBulkInput = z.infer<typeof shippingRateBulkSchema>;

export interface ShippingRateDto {
  id: string;
  zoneId: string | null;
  zoneName: Translated | null;
  wilayaCode: number | null;
  wilayaName: string | null;
  courierId: string | null;
  courierName: string | null;
  deliveryType: DeliveryType;
  priceMinor: string;
  costMinor: string;
  marginMinor: string;
  freeWeightGrams: number;
  extraPerKgMinor: string;
  freeShippingThresholdMinor: string | null;
  etaMinDays: number;
  etaMaxDays: number;
  active: boolean;
}

/** One row of the matrix editor: a wilaya with its home and stop-desk cells. */
export interface RateMatrixRow {
  wilayaCode: number;
  wilayaName: string;
  zoneName: Translated | null;
  home: RateMatrixCell | null;
  stopDesk: RateMatrixCell | null;
}

export interface RateMatrixCell {
  id: string;
  courierId: string | null;
  priceMinor: string;
  costMinor: string;
  active: boolean;
  /** True when the cell comes from the zone rather than from the wilaya itself. */
  inherited: boolean;
}

// --- couriers ---------------------------------------------------------------

/**
 * The adapters that ship with the platform.
 *
 * `manual` is not a placeholder: it is what a shop uses when it hands parcels over at a
 * counter and types the tracking number back in, which is most shops most of the time.
 */
export const COURIER_PROVIDERS = ['manual', 'yalidine', 'zrexpress', 'maystro', 'ems'] as const;
export type CourierProviderKey = (typeof COURIER_PROVIDERS)[number];

/** Credential fields each adapter needs, so Settings can draw the form. */
export const COURIER_CREDENTIAL_FIELDS: Record<
  CourierProviderKey,
  Array<{ key: string; label: string; secret: boolean; hint?: string }>
> = {
  manual: [],
  yalidine: [
    { key: 'apiId', label: 'API ID', secret: false },
    { key: 'apiToken', label: 'API token', secret: true },
    { key: 'fromWilayaId', label: 'Wilaya de départ', secret: false, hint: 'Code 1 à 58' },
  ],
  zrexpress: [
    { key: 'token', label: 'Token', secret: true },
    { key: 'key', label: 'Clé', secret: true },
  ],
  maystro: [{ key: 'apiKey', label: 'Clé API', secret: true }],
  ems: [
    { key: 'accountNumber', label: 'Numéro de compte', secret: false },
    { key: 'password', label: 'Mot de passe', secret: true },
  ],
};

export const courierInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase words joined by hyphens'),
  provider: z.enum(COURIER_PROVIDERS).default('manual'),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  codFeePercent: z.coerce.number().min(0).max(100).default(0),
  settlementDays: z.coerce.number().int().min(0).max(90).default(7),
  active: z.boolean().default(true),
});

export type CourierInput = z.infer<typeof courierInputSchema>;

/** Credentials arrive as a plain map; the API encrypts each value before storing it. */
export const courierCredentialsSchema = z.object({
  values: z.record(z.string().max(64), z.string().max(2000)),
});

export type CourierCredentialsInput = z.infer<typeof courierCredentialsSchema>;

export interface CourierDto {
  id: string;
  name: string;
  slug: string;
  provider: CourierProviderKey;
  phone: string | null;
  email: string | null;
  codFeePercent: number;
  settlementDays: number;
  active: boolean;
  /** Which credential keys are set, never their values. */
  configuredKeys: string[];
  /** True when every field the adapter needs has a value. */
  ready: boolean;
  supportsWebhook: boolean;
  supportsLabel: boolean;
  shipmentCount: number;
  openCodMinor: string;
}

// --- shipments --------------------------------------------------------------

export const createShipmentSchema = z
  .object({
    orderIds: z.array(idSchema).min(1).max(100),
    courierId: idSchema.nullable().optional(),
    driverId: idSchema.nullable().optional(),
    note: z.string().trim().max(400).optional(),
  })
  .refine((input) => Boolean(input.courierId) !== Boolean(input.driverId), {
    message: 'A parcel goes to a courier or to one of our drivers, not both',
    path: ['courierId'],
  });

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export const shipmentUpdateSchema = z.object({
  trackingNumber: z.string().trim().max(64).nullable().optional(),
  trackingUrl: z.string().trim().url().max(400).nullable().optional(),
  cost: positiveMoneySchema.optional(),
  note: z.string().trim().max(400).optional(),
});

export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>;

/** Manual couriers hand back a spreadsheet; this is one imported line of it. */
export const trackingImportSchema = z.object({
  rows: z
    .array(
      z.object({
        orderNumber: z.string().trim().min(1).max(32),
        trackingNumber: z.string().trim().min(1).max(64),
        status: z.nativeEnum(ShipmentStatus).optional(),
        cost: positiveMoneySchema.optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export type TrackingImportInput = z.infer<typeof trackingImportSchema>;

export interface ShipmentRow {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  wilayaName: string;
  communeName: string | null;
  deliveryType: DeliveryType;
  status: ShipmentStatus;
  courierId: string | null;
  courierName: string | null;
  driverId: string | null;
  driverName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  hasLabel: boolean;
  attempts: number;
  costMinor: string;
  codAmountMinor: string;
  failureReason: DeliveryFailureReason | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ShipmentDetail extends ShipmentRow {
  events: Array<{
    id: string;
    status: ShipmentStatus;
    rawStatus: string | null;
    message: string | null;
    occurredAt: string;
  }>;
}

// --- fleet ------------------------------------------------------------------

export const VEHICLE_KINDS = ['van', 'truck', 'motorbike', 'car'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

export const vehicleInputSchema = z.object({
  plate: z.string().trim().min(3).max(24),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(VEHICLE_KINDS).default('van'),
  capacityKg: z.coerce.number().int().min(0).max(50_000).default(0),
  note: z.string().trim().max(400).nullable().optional(),
  active: z.boolean().default(true),
});

export type VehicleInput = z.infer<typeof vehicleInputSchema>;

export interface VehicleDto {
  id: string;
  plate: string;
  label: string;
  kind: VehicleKind;
  capacityKg: number;
  note: string | null;
  active: boolean;
  runCount: number;
}

/**
 * A driver is a user with a role, not a separate login.
 *
 * The mobile view is the admin behind a permission, so a driver who is promoted to the
 * office keeps one account and one history.
 */
export const driverInputSchema = z.object({
  userId: idSchema.nullable().optional(),
  fullName: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: dzPhoneSchema,
  wilayaCode: z.coerce.number().int().min(1).max(58).nullable().optional(),
  licenseNo: z.string().trim().max(48).nullable().optional(),
  active: z.boolean().default(true),
});

export type DriverInput = z.infer<typeof driverInputSchema>;

export interface DriverDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  wilayaCode: number | null;
  wilayaName: string | null;
  licenseNo: string | null;
  active: boolean;
  /** Runs, stops and cash, so the list answers "who is out today". */
  openRunId: string | null;
  runCount: number;
  deliveredCount: number;
  failedCount: number;
  cashOnHandMinor: string;
}

// --- delivery runs ----------------------------------------------------------

export const DELIVERY_RUN_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type DeliveryRunStatusValue = (typeof DELIVERY_RUN_STATUSES)[number];

export const STOP_STATUSES = [
  'PENDING',
  'ARRIVED',
  'DELIVERED',
  'FAILED',
  'RESCHEDULED',
] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

export const deliveryRunInputSchema = z.object({
  date: z.coerce.date(),
  driverId: idSchema,
  vehicleId: idSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type DeliveryRunInput = z.infer<typeof deliveryRunInputSchema>;

export const runAssignSchema = z.object({
  orderIds: z.array(idSchema).min(1).max(200),
});

export type RunAssignInput = z.infer<typeof runAssignSchema>;

export const runReorderSchema = z.object({
  stopIds: z.array(idSchema).min(1).max(200),
});

export type RunReorderInput = z.infer<typeof runReorderSchema>;

export const stopUpdateSchema = z
  .object({
    status: z.enum(STOP_STATUSES),
    cashCollected: positiveMoneySchema.optional(),
    failureReason: z.nativeEnum(DeliveryFailureReason).nullable().optional(),
    note: z.string().trim().max(400).nullable().optional(),
    proofMediaId: idSchema.nullable().optional(),
  })
  .refine((input) => input.status !== 'FAILED' || Boolean(input.failureReason), {
    message: 'Say why the delivery failed',
    path: ['failureReason'],
  });

export type StopUpdateInput = z.infer<typeof stopUpdateSchema>;

export interface DeliveryRunStopDto {
  id: string;
  position: number;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  address: string | null;
  communeName: string | null;
  wilayaName: string;
  wilayaCode: number;
  latitude: number | null;
  longitude: number | null;
  itemCount: number;
  status: StopStatus;
  codAmountMinor: string;
  cashCollectedMinor: string;
  failureReason: DeliveryFailureReason | null;
  note: string | null;
  proofMediaId: string | null;
  proofUrl: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
}

export interface DeliveryRunDto {
  id: string;
  code: string;
  date: string;
  status: DeliveryRunStatusValue;
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
  note: string | null;
  startedAt: string | null;
  endedAt: string | null;
  stopCount: number;
  deliveredCount: number;
  failedCount: number;
  expectedCashMinor: string;
  collectedCashMinor: string;
  /** Straight-line kilometres through the stops, in their current order. */
  distanceKm: number;
  stops: DeliveryRunStopDto[];
}

// --- cash -------------------------------------------------------------------

export const cashReconcileSchema = z.object({
  collectionIds: z.array(idSchema).min(1).max(500),
  note: z.string().trim().max(400).optional(),
});

export type CashReconcileInput = z.infer<typeof cashReconcileSchema>;

export interface CashHolderSummary {
  kind: 'driver' | 'courier';
  id: string;
  name: string;
  /** Cash the orders say should exist. */
  expectedMinor: string;
  /** Cash actually reported collected. */
  collectedMinor: string;
  /** Collected but not yet counted in. */
  outstandingMinor: string;
  orderCount: number;
}

export interface CashDaySummary {
  date: string;
  expectedMinor: string;
  collectedMinor: string;
  reconciledMinor: string;
  outstandingMinor: string;
  holders: CashHolderSummary[];
}

// --- settlements ------------------------------------------------------------

export const SETTLEMENT_STATUSES = ['OPEN', 'SENT', 'PAID', 'DISPUTED'] as const;
export type SettlementStatusValue = (typeof SETTLEMENT_STATUSES)[number];

export const settlementGenerateSchema = z
  .object({
    courierId: idSchema,
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((input) => input.to >= input.from, {
    message: 'The period ends after it starts',
    path: ['to'],
  });

export type SettlementGenerateInput = z.infer<typeof settlementGenerateSchema>;

export const settlementPaySchema = z.object({
  paidAmount: positiveMoneySchema,
  paidAt: z.coerce.date().optional(),
  note: z.string().trim().max(2000).optional(),
});

export type SettlementPayInput = z.infer<typeof settlementPaySchema>;

export interface SettlementLineDto {
  id: string;
  orderId: string;
  orderNumber: string;
  deliveredAt: string | null;
  codAmountMinor: string;
  feeAmountMinor: string;
  netAmountMinor: string;
  note: string | null;
}

export interface SettlementDto {
  id: string;
  reference: string;
  courierId: string;
  courierName: string;
  periodFrom: string;
  periodTo: string;
  status: SettlementStatusValue;
  grossAmountMinor: string;
  feesAmountMinor: string;
  netAmountMinor: string;
  paidAmountMinor: string;
  differenceMinor: string;
  paidAt: string | null;
  note: string | null;
  lineCount: number;
  lines?: SettlementLineDto[];
}

// --- analytics --------------------------------------------------------------

export interface DeliveryAnalytics {
  from: string;
  to: string;
  shipped: number;
  delivered: number;
  failed: number;
  returned: number;
  /** Delivered against everything that reached a final state, as a percentage. */
  successRate: number;
  /** Hours from shipping to delivery, over delivered shipments only. */
  averageHours: number;
  shippingCostMinor: string;
  shippingRevenueMinor: string;
  byCourier: Array<{
    courierId: string | null;
    courierName: string;
    shipped: number;
    delivered: number;
    failed: number;
    successRate: number;
    averageHours: number;
    costMinor: string;
  }>;
  byWilaya: Array<{
    wilayaCode: number;
    wilayaName: string;
    shipped: number;
    delivered: number;
    failed: number;
    successRate: number;
  }>;
  byFailureReason: Array<{ reason: DeliveryFailureReason; count: number }>;
  series: Array<{ date: string; shipped: number; delivered: number; failed: number }>;
}

// --- errors -----------------------------------------------------------------

export const DELIVERY_ERRORS = {
  NO_SHIPPING_RATE: 'NO_SHIPPING_RATE',
  RATE_IN_USE: 'RATE_IN_USE',
  ZONE_IN_USE: 'ZONE_IN_USE',
  COURIER_NOT_READY: 'COURIER_NOT_READY',
  COURIER_IN_USE: 'COURIER_IN_USE',
  COURIER_REJECTED: 'COURIER_REJECTED',
  ORDER_NOT_SHIPPABLE: 'ORDER_NOT_SHIPPABLE',
  ALREADY_SHIPPED: 'ALREADY_SHIPPED',
  SHIPMENT_NOT_CANCELLABLE: 'SHIPMENT_NOT_CANCELLABLE',
  LABEL_UNAVAILABLE: 'LABEL_UNAVAILABLE',
  RUN_NOT_EDITABLE: 'RUN_NOT_EDITABLE',
  RUN_CLOSED: 'RUN_CLOSED',
  STOP_ALREADY_CLOSED: 'STOP_ALREADY_CLOSED',
  DRIVER_BUSY: 'DRIVER_BUSY',
  DRIVER_HAS_RUNS: 'DRIVER_HAS_RUNS',
  VEHICLE_IN_USE: 'VEHICLE_IN_USE',
  SETTLEMENT_EMPTY: 'SETTLEMENT_EMPTY',
  SETTLEMENT_LOCKED: 'SETTLEMENT_LOCKED',
  WEBHOOK_SIGNATURE: 'WEBHOOK_SIGNATURE',
} as const;

export type DeliveryErrorCode = (typeof DELIVERY_ERRORS)[keyof typeof DELIVERY_ERRORS];
