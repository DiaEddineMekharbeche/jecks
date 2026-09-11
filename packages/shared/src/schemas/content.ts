import { z } from 'zod';
import type { Translated } from '../i18n/index.js';
import {
  idSchema,
  slugSchema,
  translatedOptionalSchema,
  translatedSchema,
} from './common.js';

/**
 * Content and merchandising — PRD F-AD-90/91 and F-ST-01/02.
 *
 * Everything a shop changes without a developer: what the home page shows, what the
 * banner says, which pages exist and where the old URLs now point.
 *
 * Every scheduled thing here carries `startsAt`/`endsAt` and is filtered by the
 * storefront on read, so a flash sale banner disappears on its own at midnight rather
 * than waiting for somebody to switch it off.
 */

// --- home sections ----------------------------------------------------------

export const HOME_SECTION_KINDS = [
  'hero_3d',
  'featured_collections',
  'new_arrivals',
  'best_sellers',
  'promo_countdown',
  'lookbook',
  'brand_story',
  'testimonials',
  'newsletter',
] as const;

export type HomeSectionKind = (typeof HOME_SECTION_KINDS)[number];

export const homeSectionInputSchema = z.object({
  kind: z.enum(HOME_SECTION_KINDS),
  title: translatedOptionalSchema.nullable().optional(),
  subtitle: translatedOptionalSchema.nullable().optional(),
  ctaLabel: translatedOptionalSchema.nullable().optional(),
  ctaUrl: z.string().trim().max(400).nullable().optional(),
  mediaId: idSchema.nullable().optional(),
  collectionId: idSchema.nullable().optional(),
  productId: idSchema.nullable().optional(),
  /** Section-specific knobs: item counts, a model URL, a countdown target. */
  config: z.record(z.unknown()).nullable().optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

export type HomeSectionInput = z.infer<typeof homeSectionInputSchema>;

export interface HomeSectionDto {
  id: string;
  kind: HomeSectionKind;
  title: Translated | null;
  subtitle: Translated | null;
  ctaLabel: Translated | null;
  ctaUrl: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  collectionId: string | null;
  collectionName: Translated | null;
  productId: string | null;
  config: Record<string, unknown> | null;
  position: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Whether it would be shown right now, dates and switch together. */
  live: boolean;
}

export const reorderSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
});

export type ReorderInput = z.infer<typeof reorderSchema>;

// --- banners ----------------------------------------------------------------

export const BANNER_PLACEMENTS = [
  'home_hero',
  'home_mid',
  'collection_top',
  'product_side',
  'cart_upsell',
] as const;

export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export const bannerInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  placement: z.enum(BANNER_PLACEMENTS),
  title: translatedOptionalSchema.nullable().optional(),
  subtitle: translatedOptionalSchema.nullable().optional(),
  ctaLabel: translatedOptionalSchema.nullable().optional(),
  ctaUrl: z.string().trim().max(400).nullable().optional(),
  mediaId: idSchema.nullable().optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

export type BannerInput = z.infer<typeof bannerInputSchema>;

export interface BannerDto {
  id: string;
  name: string;
  placement: BannerPlacement;
  title: Translated | null;
  subtitle: Translated | null;
  ctaLabel: Translated | null;
  ctaUrl: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  position: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  live: boolean;
}

// --- announcements ----------------------------------------------------------

export const announcementInputSchema = z.object({
  message: translatedSchema,
  linkUrl: z.string().trim().max(400).nullable().optional(),
  bgColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1B2A45')
    .nullable()
    .optional(),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #FFFFFF')
    .nullable()
    .optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export interface AnnouncementDto {
  id: string;
  message: Translated;
  linkUrl: string | null;
  bgColor: string | null;
  textColor: string | null;
  position: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  live: boolean;
}

// --- pages ------------------------------------------------------------------

export const PAGE_KINDS = ['page', 'post', 'legal'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const pageInputSchema = z.object({
  slug: slugSchema,
  title: translatedSchema,
  /** Rich text, stored as a translated document the storefront renders. */
  body: translatedSchema,
  excerpt: translatedOptionalSchema.nullable().optional(),
  heroMediaId: idSchema.nullable().optional(),
  seoTitle: translatedOptionalSchema.nullable().optional(),
  seoDescription: translatedOptionalSchema.nullable().optional(),
  kind: z.enum(PAGE_KINDS).default('page'),
  published: z.boolean().default(false),
});

export type PageInput = z.infer<typeof pageInputSchema>;

export interface PageRow {
  id: string;
  slug: string;
  title: Translated;
  kind: PageKind;
  published: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface PageDetail extends PageRow {
  body: Translated;
  excerpt: Translated | null;
  heroMediaId: string | null;
  heroUrl: string | null;
  seoTitle: Translated | null;
  seoDescription: Translated | null;
}

// --- menus ------------------------------------------------------------------

export const menuInputSchema = z.object({
  slug: slugSchema,
  name: translatedSchema,
});

export type MenuInput = z.infer<typeof menuInputSchema>;

export const menuItemInputSchema = z.object({
  parentId: idSchema.nullable().optional(),
  label: translatedSchema,
  url: z.string().trim().min(1).max(400),
  imageKey: z.string().trim().max(400).nullable().optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
  openInNewTab: z.boolean().default(false),
});

export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export interface MenuItemDto {
  id: string;
  parentId: string | null;
  label: Translated;
  url: string;
  imageKey: string | null;
  position: number;
  openInNewTab: boolean;
  children: MenuItemDto[];
}

export interface MenuDto {
  id: string;
  slug: string;
  name: Translated;
  items: MenuItemDto[];
}

// --- redirects --------------------------------------------------------------

export const redirectInputSchema = z
  .object({
    fromPath: z.string().trim().min(1).max(400).startsWith('/', 'A path starts with /'),
    toPath: z.string().trim().min(1).max(400),
    statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
  })
  .refine((input) => input.fromPath !== input.toPath, {
    message: 'A redirect to itself is a loop',
    path: ['toPath'],
  });

export type RedirectInput = z.infer<typeof redirectInputSchema>;

export interface RedirectRow {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  hits: number;
  createdAt: string;
}

// --- newsletter -------------------------------------------------------------

export const NEWSLETTER_PROVIDERS = ['log', 'brevo'] as const;
export type NewsletterProviderKey = (typeof NEWSLETTER_PROVIDERS)[number];

export interface NewsletterSubscriberRow {
  id: string;
  email: string | null;
  phone: string | null;
  locale: string;
  source: string | null;
  confirmed: boolean;
  unsubscribed: boolean;
  createdAt: string;
}

export interface NewsletterStats {
  total: number;
  confirmed: number;
  unsubscribed: number;
  last30Days: number;
  bySource: Array<{ source: string; count: number }>;
}

export const newsletterSyncSchema = z.object({
  /** Only subscribers added since this date; omit for everyone. */
  since: z.coerce.date().optional(),
});

export type NewsletterSyncInput = z.infer<typeof newsletterSyncSchema>;

// --- abandoned carts --------------------------------------------------------

export interface AbandonedCartRow {
  id: string;
  cartId: string;
  customerId: string | null;
  fullName: string | null;
  phone: string | null;
  wilayaCode: number | null;
  itemCount: number;
  subtotalMinor: string;
  recoveryUrl: string | null;
  contactedAt: string | null;
  recoveredOrderId: string | null;
  recoveredOrderNumber: string | null;
  createdAt: string;
}

export interface AbandonedCartStats {
  open: number;
  contacted: number;
  recovered: number;
  /** Value sitting in carts nobody has chased yet. */
  openValueMinor: string;
  recoveredValueMinor: string;
  /** Recovered against contacted, as a percentage. */
  recoveryRate: number;
}

export const contactCartSchema = z.object({
  cartIds: z.array(idSchema).min(1).max(100),
});

export type ContactCartInput = z.infer<typeof contactCartSchema>;

// --- affiliates -------------------------------------------------------------

export const affiliateInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  handle: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Lowercase letters, digits, dots, dashes'),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  promotionId: idSchema.nullable().optional(),
  commissionPercent: z.coerce.number().min(0).max(50).default(0),
  active: z.boolean().default(true),
});

export type AffiliateInput = z.infer<typeof affiliateInputSchema>;

export interface AffiliateRow {
  id: string;
  name: string;
  handle: string;
  phone: string | null;
  email: string | null;
  promotionId: string | null;
  promotionCode: string | null;
  commissionPercent: number;
  active: boolean;
  /** Orders attributed through their promotion code, delivered only. */
  orders: number;
  revenueMinor: string;
  commissionMinor: string;
  createdAt: string;
}

// --- errors -----------------------------------------------------------------

export const CONTENT_ERRORS = {
  SLUG_TAKEN: 'SLUG_TAKEN',
  MENU_IN_USE: 'MENU_IN_USE',
  REDIRECT_LOOP: 'REDIRECT_LOOP',
  HANDLE_TAKEN: 'HANDLE_TAKEN',
  NEWSLETTER_NOT_READY: 'NEWSLETTER_NOT_READY',
} as const;

export type ContentErrorCode = (typeof CONTENT_ERRORS)[keyof typeof CONTENT_ERRORS];
