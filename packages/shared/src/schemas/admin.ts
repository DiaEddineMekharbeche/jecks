import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Conventions every admin list endpoint follows — PRD-COMPLETION Section 2.3.
 *
 * One schema means one URL shape across orders, products, customers and the rest, so
 * `useServerTable` on the frontend and the list helper on the API agree without either
 * knowing which module is calling.
 */

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;

export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  /** Capped so a careless client cannot ask for the whole table in one request. */
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.string().max(64).optional(),
  order: z.enum(SORT_DIRECTIONS).default('desc'),
  /** Free-text search; each module decides which columns it covers. */
  q: z.string().trim().max(160).optional(),
  /** Streams a file instead of JSON. */
  format: z.enum(EXPORT_FORMATS).optional(),
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export interface AdminListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminListResponse<T> {
  data: T[];
  meta: AdminListMeta;
}

/** Rows an export may stream inline; beyond this it becomes a background job. */
export const EXPORT_INLINE_LIMIT = 5_000;
/** Hard ceiling on any export, background or not. */
export const EXPORT_MAX_ROWS = 50_000;

// --- Saved views ------------------------------------------------------------

export const savedViewStateSchema = z.object({
  filters: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  sort: z.string().max(64).optional(),
  order: z.enum(SORT_DIRECTIONS).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().max(160).optional(),
  /** Column id to visibility; absent columns keep the module default. */
  columns: z.record(z.boolean()).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
});

export const savedViewInputSchema = z.object({
  module: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z][a-z0-9-]*$/, 'Module keys are lowercase words joined by hyphens'),
  name: z.string().trim().min(1).max(120),
  state: savedViewStateSchema,
  isDefault: z.boolean().default(false),
  isShared: z.boolean().default(false),
});

export const savedViewUpdateSchema = savedViewInputSchema.partial().omit({ module: true });

export type SavedViewState = z.infer<typeof savedViewStateSchema>;
export type SavedViewInput = z.infer<typeof savedViewInputSchema>;

export interface SavedView {
  id: string;
  module: string;
  name: string;
  state: SavedViewState;
  isDefault: boolean;
  isShared: boolean;
  position: number;
  /** True when the signed-in user authored it, so the UI knows what may be edited. */
  isOwn: boolean;
}

// --- Bulk actions -----------------------------------------------------------

export const bulkIdsSchema = z.object({
  ids: z.array(idSchema).min(1, 'Select at least one row').max(500),
});

export type BulkIdsInput = z.infer<typeof bulkIdsSchema>;

// --- Realtime ---------------------------------------------------------------

/** Server-sent event names the admin subscribes to — DECISIONS D12. */
export const ADMIN_EVENTS = [
  'connected',
  'ping',
  'order.created',
  'order.transitioned',
  'shipment.updated',
  'inventory.low',
  'notification',
] as const;

export type AdminEventName = (typeof ADMIN_EVENTS)[number];

export interface AdminEvent<T = unknown> {
  name: AdminEventName;
  /** Monotonic per connection; lets a client detect a gap after a reconnect. */
  id: string;
  at: string;
  payload: T;
}

// --- Global search (command palette) ----------------------------------------

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type GlobalSearchGroup = 'orders' | 'products' | 'customers';

export interface GlobalSearchHit {
  group: GlobalSearchGroup;
  id: string;
  title: string;
  subtitle?: string;
  /** Admin route to open, e.g. `/orders/{id}`. */
  href: string;
}

// --- Storefront cache -------------------------------------------------------

/**
 * Cache tags the storefront fetches with, and the only ones its `/api/revalidate` route
 * will act on. The API sends these after an admin write. Kept here because the two sides
 * run in different processes and a tag spelled differently on one of them fails silently:
 * the page simply keeps its old content until its timer runs out.
 */
export const STOREFRONT_CACHE_TAGS = [
  'products',
  'collections',
  'home',
  'bootstrap',
  'reviews',
  'sitemap',
  'pages',
] as const;

export type StorefrontCacheTag = (typeof STOREFRONT_CACHE_TAGS)[number];
