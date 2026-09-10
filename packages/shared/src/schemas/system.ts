import { z } from 'zod';
import { NotificationChannel } from '../enums/index.js';
import { PERMISSIONS, type Permission } from '../enums/permissions.js';
import type { Translated } from '../i18n/index.js';
import { dzPhoneSchema, emailSchema, idSchema, translatedSchema } from './common.js';

/**
 * Settings, users, roles, audit and backups — PRD F-AD-91 to F-AD-93.
 *
 * Settings are validated per scope rather than per key. A scope is the unit the admin
 * saves: one screen section, one PATCH, one audit row. Validating the whole scope means
 * a change that is only valid alongside another one (a free-shipping threshold with the
 * currency it is quoted in) can be checked, which key-by-key validation cannot do.
 */

// --- settings ---------------------------------------------------------------

export const SETTING_SCOPES = [
  'store',
  'localisation',
  'tax',
  'orders',
  'checkout',
  'loyalty',
  'inventory',
  'theme',
  'integrations',
  'notifications',
  'payments',
  'couriers',
  'maintenance',
] as const;

export type SettingScope = (typeof SETTING_SCOPES)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #D9B36A');

/**
 * One schema per scope. Everything is `.partial()`-friendly at the controller because
 * the admin sends only what changed, but each field is typed so a string never lands
 * where the API later expects a number.
 */
export const settingScopeSchemas = {
  store: z.object({
    'store.name': z.string().trim().min(1).max(120),
    'store.legal_name': z.string().trim().max(160),
    'store.email': emailSchema,
    'store.phones': z.array(z.string().trim().min(6).max(20)).max(5),
    'store.address': z.string().trim().max(400),
    'store.rc': z.string().trim().max(40),
    'store.nif': z.string().trim().max(40),
    'store.currency': z.enum(['DZD']),
  }),

  localisation: z.object({
    'store.timezone': z.string().trim().min(3).max(64),
    'store.locales': z.array(z.enum(['fr', 'ar', 'en'])).min(1),
    'store.default_locale': z.enum(['fr', 'ar', 'en']),
  }),

  tax: z.object({
    'tax.vat_percent': z.coerce.number().min(0).max(100),
    'tax.prices_include_tax': z.boolean(),
  }),

  orders: z.object({
    /** DECISIONS D20 — when stock leaves the shelf in the eyes of the ledger. */
    'orders.stock_deduction_moment': z.enum(['confirmed', 'packed', 'shipped', 'delivered']),
    'orders.number_format': z.string().trim().min(3).max(48),
    'orders.auto_confirm': z.boolean(),
    'orders.duplicate_window_minutes': z.coerce.number().int().min(0).max(1440),
    'orders.max_per_phone_per_day': z.coerce.number().int().min(1).max(50),
    'orders.captcha_after_attempts': z.coerce.number().int().min(1).max(20),
    'orders.require_otp': z.boolean(),
  }),

  checkout: z.object({
    /** Minor units. Zero disables the free-shipping bar entirely. */
    'checkout.free_shipping_threshold': z.coerce.number().int().min(0),
    'checkout.allow_guest': z.boolean(),
    'checkout.collect_email': z.boolean(),
    'checkout.second_phone': z.boolean(),
  }),

  loyalty: z.object({
    'loyalty.enabled': z.boolean(),
    'loyalty.points_per_currency_unit': z.coerce.number().min(0).max(10),
    'loyalty.point_value_centimes': z.coerce.number().int().min(0),
    'loyalty.max_order_percent': z.coerce.number().min(0).max(100),
  }),

  inventory: z.object({
    'inventory.low_stock_threshold': z.coerce.number().int().min(0).max(10_000),
    'inventory.allow_backorder': z.boolean(),
  }),

  theme: z.object({
    'theme.primary_color': hexColor,
    'theme.base_color': hexColor,
    'theme.surface_color': hexColor,
    'theme.logo_media_id': idSchema.nullable().optional(),
    'theme.favicon_media_id': idSchema.nullable().optional(),
    'theme.hero_model_media_id': idSchema.nullable().optional(),
  }),

  integrations: z.object({
    'integrations.ga4_id': z.string().trim().max(40),
    'integrations.meta_pixel_id': z.string().trim().max(40),
    'integrations.tiktok_pixel_id': z.string().trim().max(40),
    'integrations.cookie_banner': z.boolean(),
  }),

  notifications: z.object({
    'notifications.sms_driver': z.enum(['log', 'twilio', 'http', 'whatsapp']),
    'notifications.sms_endpoint': z.string().trim().max(400).optional(),
    'notifications.sms_credentials': z.string().max(2000).optional(),
    'notifications.email_driver': z.enum(['log', 'smtp']),
    'notifications.telegram_enabled': z.boolean(),
    'notifications.telegram_token': z.string().max(200).optional(),
    'notifications.telegram_chat_id': z.string().max(64).optional(),
    'notifications.owner_alerts': z.array(z.string().max(64)).max(30),
  }),

  payments: z.object({
    'payments.default_provider': z.enum(['cod', 'chargily']),
    'payments.cod_enabled': z.boolean(),
    'payments.chargily_enabled': z.boolean(),
    'payments.chargily_api_key': z.string().max(200).optional(),
    'payments.chargily_secret': z.string().max(200).optional(),
    /** Minor units taken up front on a COD order; zero means none. */
    'payments.cod_deposit_minor': z.coerce.number().int().min(0),
  }),

  couriers: z.object({
    'couriers.default_provider': z.string().trim().max(40),
    'couriers.auto_create_shipment': z.boolean(),
    'couriers.sync_interval_minutes': z.coerce.number().int().min(5).max(1440),
  }),

  maintenance: z.object({
    'store.maintenance_mode': z.boolean(),
    'store.maintenance_message': z.string().trim().max(400).optional(),
  }),
} satisfies Record<SettingScope, z.ZodObject<z.ZodRawShape>>;

/** Keys whose stored value is encrypted and never returned in full. */
export const SECRET_SETTING_KEYS = [
  'notifications.sms_credentials',
  'notifications.telegram_token',
  'payments.chargily_api_key',
  'payments.chargily_secret',
] as const;

/** A saved secret comes back as this, so the UI can show "set" without the value. */
export const SECRET_MASK = '••••••••';

export interface SettingsScopeDto {
  scope: SettingScope;
  values: Record<string, unknown>;
  updatedAt: string | null;
}

// --- notification templates -------------------------------------------------

export const NOTIFICATION_EVENTS = [
  'order.placed',
  'order.confirmed',
  'order.shipped',
  'order.out_for_delivery',
  'order.delivered',
  'order.failed',
  'order.cancelled',
  'stock.back_in_stock',
  'cart.abandoned',
  'review.request',
  'inventory.low',
  'owner.new_order',
  'auth.otp',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const notificationTemplateSchema = z.object({
  event: z.string().trim().min(3).max(64),
  channel: z.enum([
    NotificationChannel.SMS,
    NotificationChannel.EMAIL,
    NotificationChannel.WHATSAPP,
    NotificationChannel.TELEGRAM,
    NotificationChannel.IN_APP,
  ]),
  subject: z
    .object({ fr: z.string().max(200), ar: z.string().max(200).optional(), en: z.string().max(200).optional() })
    .optional(),
  body: z.object({
    fr: z.string().min(1).max(4000),
    ar: z.string().max(4000).optional(),
    en: z.string().max(4000).optional(),
  }),
  active: z.boolean().default(true),
});

export type NotificationTemplateInput = z.infer<typeof notificationTemplateSchema>;

export interface NotificationTemplateDto {
  id: string;
  event: string;
  channel: NotificationChannel;
  subject: Translated | null;
  body: Translated;
  active: boolean;
  updatedAt: string;
}

export const templateTestSchema = z.object({
  /** Phone or e-mail, depending on the channel. */
  recipient: z.string().trim().min(3).max(255),
  locale: z.enum(['fr', 'ar', 'en']).default('fr'),
});

export type TemplateTestInput = z.infer<typeof templateTestSchema>;

/** Variables the editor offers, per event. Rendering is Handlebars-style `{{name}}`. */
export const TEMPLATE_VARIABLES: Record<string, string[]> = {
  'order.placed': ['customerName', 'orderNumber', 'total', 'trackingUrl', 'storeName'],
  'order.confirmed': ['customerName', 'orderNumber', 'total', 'trackingUrl', 'storeName'],
  'order.shipped': ['customerName', 'orderNumber', 'courier', 'trackingNumber', 'trackingUrl'],
  'order.out_for_delivery': ['customerName', 'orderNumber', 'driverName', 'driverPhone'],
  'order.delivered': ['customerName', 'orderNumber', 'total', 'storeName'],
  'order.failed': ['customerName', 'orderNumber', 'reason', 'storePhone'],
  'order.cancelled': ['customerName', 'orderNumber', 'reason'],
  'stock.back_in_stock': ['customerName', 'productName', 'productUrl'],
  'cart.abandoned': ['customerName', 'cartUrl', 'total', 'promoCode'],
  'review.request': ['customerName', 'orderNumber', 'productName', 'reviewUrl'],
  'inventory.low': ['productName', 'sku', 'available', 'locationName'],
  'owner.new_order': ['orderNumber', 'total', 'wilaya', 'customerPhone'],
  'auth.otp': ['code', 'storeName', 'minutes'],
};

// --- users ------------------------------------------------------------------

export const staffInviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  roleId: idSchema,
});

export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

export const staffUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: emailSchema.optional(),
  phone: dzPhoneSchema.optional(),
  locale: z.enum(['fr', 'ar', 'en']).optional(),
  active: z.boolean().optional(),
  roleIds: z.array(idSchema).max(10).optional(),
});

export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

export const staffPasswordSchema = z.object({
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200)
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/\d/, 'Include a digit'),
});

export type StaffPasswordInput = z.infer<typeof staffPasswordSchema>;

export interface StaffRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  locale: string;
  active: boolean;
  twoFactorEnabled: boolean;
  roles: Array<{ id: string; slug: string; name: Translated }>;
  lastLoginAt: string | null;
  activeSessions: number;
  createdAt: string;
}

export interface StaffInvitationRow {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: Translated;
  invitedByName: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  /** True once `expiresAt` has passed and it was never accepted. */
  expired: boolean;
}

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  password: staffPasswordSchema.shape.password,
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

// --- roles ------------------------------------------------------------------

export const roleInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, 'Role keys are lowercase words joined by underscores'),
  name: translatedSchema,
  description: z.string().trim().max(255).optional(),
  permissions: z
    .array(z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]]))
    .max(PERMISSIONS.length),
});

export type RoleInput = z.infer<typeof roleInputSchema>;

export const rolePermissionsSchema = roleInputSchema.pick({ permissions: true });

export interface RoleDto {
  id: string;
  slug: string;
  name: Translated;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
}

export interface PermissionDto {
  key: Permission;
  group: string;
  description: string | null;
}

// --- audit ------------------------------------------------------------------

export interface AuditListFilters {
  entityType?: string[];
  entityId?: string[];
  actorId?: string[];
  action?: string[];
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  /** `{ field: { before, after } }`, secrets already redacted when written. */
  changes: Record<string, { before?: unknown; after?: unknown }> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

// --- backups ----------------------------------------------------------------

export interface BackupRow {
  id: string;
  key: string;
  sizeBytes: number;
  status: 'running' | 'ready' | 'failed';
  error: string | null;
  createdAt: string;
  /** Signed, short-lived; absent while the dump is still running. */
  downloadUrl: string | null;
}

export const SYSTEM_ERRORS = {
  SETTING_SCOPE_UNKNOWN: 'SETTING_SCOPE_UNKNOWN',
  ROLE_IS_SYSTEM: 'ROLE_IS_SYSTEM',
  ROLE_IN_USE: 'ROLE_IN_USE',
  LAST_OWNER: 'LAST_OWNER',
  SELF_DEACTIVATE: 'SELF_DEACTIVATE',
  INVITATION_INVALID: 'INVITATION_INVALID',
  BACKUP_FAILED: 'BACKUP_FAILED',
} as const;
