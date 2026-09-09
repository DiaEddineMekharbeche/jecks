/**
 * Domain enums shared by the API, the admin and the storefront.
 * These mirror the Prisma enums in packages/db/prisma/schema.prisma one-for-one;
 * changing one without the other is a bug.
 */

export const OrderStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Statuses that still allow editing the line items (PRD F-AD-31). */
export const EDITABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
];

/** Statuses that count as revenue in the P&L (PRD F-AD-70). */
export const REVENUE_ORDER_STATUSES: readonly OrderStatus[] = [OrderStatus.DELIVERED];

export const PaymentStatus = {
  UNPAID: 'UNPAID',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  COD: 'COD',
  CARD: 'CARD',
  BANK_TRANSFER: 'BANK_TRANSFER',
  LOYALTY: 'LOYALTY',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const DeliveryType = {
  HOME: 'HOME',
  STOP_DESK: 'STOP_DESK',
} as const;
export type DeliveryType = (typeof DeliveryType)[keyof typeof DeliveryType];

export const ShipmentStatus = {
  CREATED: 'CREATED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;
export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const DeliveryFailureReason = {
  NO_ANSWER: 'NO_ANSWER',
  REFUSED: 'REFUSED',
  WRONG_ADDRESS: 'WRONG_ADDRESS',
  CUSTOMER_ABSENT: 'CUSTOMER_ABSENT',
  RESCHEDULED: 'RESCHEDULED',
  DAMAGED: 'DAMAGED',
  OTHER: 'OTHER',
} as const;
export type DeliveryFailureReason =
  (typeof DeliveryFailureReason)[keyof typeof DeliveryFailureReason];

export const CallOutcome = {
  CONFIRMED: 'CONFIRMED',
  NO_ANSWER: 'NO_ANSWER',
  CANCELLED: 'CANCELLED',
  CALL_BACK: 'CALL_BACK',
  WRONG_NUMBER: 'WRONG_NUMBER',
} as const;
export type CallOutcome = (typeof CallOutcome)[keyof typeof CallOutcome];

export const ProductStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const StockMovementReason = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER: 'TRANSFER',
  DAMAGED: 'DAMAGED',
  STOCK_COUNT: 'STOCK_COUNT',
  RESERVATION: 'RESERVATION',
  RELEASE: 'RELEASE',
} as const;
export type StockMovementReason = (typeof StockMovementReason)[keyof typeof StockMovementReason];

export const PromotionType = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED_AMOUNT: 'FIXED_AMOUNT',
  FREE_SHIPPING: 'FREE_SHIPPING',
  BUY_X_GET_Y: 'BUY_X_GET_Y',
  BUNDLE_PRICE: 'BUNDLE_PRICE',
  TIERED: 'TIERED',
} as const;
export type PromotionType = (typeof PromotionType)[keyof typeof PromotionType];

export const PromotionScope = {
  ORDER: 'ORDER',
  PRODUCT: 'PRODUCT',
  VARIANT: 'VARIANT',
  COLLECTION: 'COLLECTION',
  CATEGORY: 'CATEGORY',
  SHIPPING: 'SHIPPING',
} as const;
export type PromotionScope = (typeof PromotionScope)[keyof typeof PromotionScope];

export const MediaKind = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  MODEL_3D: 'MODEL_3D',
  DOCUMENT: 'DOCUMENT',
} as const;
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];

export const UserType = {
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
} as const;
export type UserType = (typeof UserType)[keyof typeof UserType];

/** Roles seeded by packages/db/prisma/seed — PRD F-AD-92. */
export const RoleSlug = {
  OWNER: 'owner',
  MANAGER: 'manager',
  ORDER_AGENT: 'order_agent',
  WAREHOUSE: 'warehouse',
  DRIVER: 'driver',
  MARKETING: 'marketing',
  ACCOUNTANT: 'accountant',
} as const;
export type RoleSlug = (typeof RoleSlug)[keyof typeof RoleSlug];

export const Locale = {
  FR: 'fr',
  AR: 'ar',
  EN: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

export const LOCALES: readonly Locale[] = [Locale.FR, Locale.AR, Locale.EN];
export const DEFAULT_LOCALE: Locale = Locale.FR;
export const RTL_LOCALES: readonly Locale[] = [Locale.AR];

export const OrderSource = {
  WEB: 'WEB',
  PHONE: 'PHONE',
  INSTAGRAM: 'INSTAGRAM',
  FACEBOOK: 'FACEBOOK',
  TIKTOK: 'TIKTOK',
  WHATSAPP: 'WHATSAPP',
  ADMIN: 'ADMIN',
} as const;
export type OrderSource = (typeof OrderSource)[keyof typeof OrderSource];

export const ReturnCondition = {
  RESELLABLE: 'RESELLABLE',
  DAMAGED: 'DAMAGED',
  MISSING_PARTS: 'MISSING_PARTS',
} as const;
export type ReturnCondition = (typeof ReturnCondition)[keyof typeof ReturnCondition];

export const PurchaseOrderStatus = {
  DRAFT: 'DRAFT',
  ORDERED: 'ORDERED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

export const CustomerSegment = {
  NEW: 'NEW',
  RETURNING: 'RETURNING',
  VIP: 'VIP',
  AT_RISK: 'AT_RISK',
  BLACKLISTED: 'BLACKLISTED',
} as const;
export type CustomerSegment = (typeof CustomerSegment)[keyof typeof CustomerSegment];

export const NotificationChannel = {
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
  TELEGRAM: 'TELEGRAM',
  IN_APP: 'IN_APP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const CollectionRuleField = {
  TAG: 'TAG',
  CATEGORY: 'CATEGORY',
  BRAND: 'BRAND',
  PRICE: 'PRICE',
  DISCOUNT: 'DISCOUNT',
  STOCK: 'STOCK',
  CREATED_AT: 'CREATED_AT',
  TITLE: 'TITLE',
} as const;
export type CollectionRuleField = (typeof CollectionRuleField)[keyof typeof CollectionRuleField];

export const RuleOperator = {
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  CONTAINS: 'CONTAINS',
  GREATER_THAN: 'GREATER_THAN',
  LESS_THAN: 'LESS_THAN',
  IN: 'IN',
} as const;
export type RuleOperator = (typeof RuleOperator)[keyof typeof RuleOperator];
