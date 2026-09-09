import { z } from 'zod';
import { ProductStatus, ReviewStatus } from '../enums/index.js';
import type { Translated } from '../i18n/index.js';
import { adminListQuerySchema } from './admin.js';
import {
  categoryInputSchema,
  collectionRuleSchema,
  optionSetSchema,
  productInputBase,
  variantInputSchema,
} from './catalog.js';
import {
  idSchema,
  positiveMoneySchema,
  slugSchema,
  translatedOptionalSchema,
  translatedSchema,
} from './common.js';
import type { Rendition } from './media.js';

/**
 * Catalog administration contracts — PRD F-AD-10 to F-AD-13.
 *
 * These extend the storefront-facing schemas in `catalog.ts` rather than restating
 * them: a product the admin writes and a product the storefront reads must be the same
 * shape, or the two drift and nobody notices until a customer sees the difference.
 */

// --- products ---------------------------------------------------------------

export const productListQuerySchema = adminListQuerySchema;

/** Stock buckets the list filters by; the API turns them into ranges. */
export const STOCK_STATES = ['in', 'low', 'out'] as const;
export type StockState = (typeof STOCK_STATES)[number];

/** Parsed out of `filter[...]`, so every value arrives as a string array. */
export interface ProductListFilters {
  status?: string[];
  categoryId?: string[];
  collectionId?: string[];
  brandId?: string[];
  tagId?: string[];
  stock?: string[];
  minPrice?: string[];
  maxPrice?: string[];
  hasMedia?: string[];
}

/** Whole-entity update of everything except variants, which have their own routes. */
export const productPatchSchema = productInputBase.omit({ variants: true }).partial();

export const productDuplicateSchema = z.object({
  name: translatedSchema.optional(),
  slug: slugSchema.optional(),
  includeMedia: z.boolean().default(true),
  includeVariants: z.boolean().default(true),
});

/**
 * Bulk edit — PRD F-AD-10. A price move is expressed as an operation rather than a
 * final amount, because "raise everything 10 %" is the actual request and computing it
 * per row in the browser would round twenty different ways.
 */
export const productBulkPriceSchema = z.object({
  mode: z.enum(['set', 'increase', 'decrease']),
  /** Exactly one of the two: a flat amount in minor units, or a percentage. */
  amountMinor: positiveMoneySchema.optional(),
  percent: z.coerce.number().min(0).max(500).optional(),
  target: z.enum(['price', 'compareAtPrice', 'costPrice']).default('price'),
});

export const productBulkUpdateSchema = z
  .object({
    ids: z.array(idSchema).min(1, 'Select at least one product').max(500),
    status: z.nativeEnum(ProductStatus).optional(),
    categoryId: idSchema.nullable().optional(),
    brandId: idSchema.nullable().optional(),
    addCollectionIds: z.array(idSchema).default([]),
    removeCollectionIds: z.array(idSchema).default([]),
    addTagIds: z.array(idSchema).default([]),
    removeTagIds: z.array(idSchema).default([]),
    price: productBulkPriceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.price) {
      const hasAmount = value.price.amountMinor !== undefined;
      const hasPercent = value.price.percent !== undefined;
      if (hasAmount === hasPercent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price'],
          message: 'Give either an amount or a percentage, not both',
        });
      }
    }

    const touchesSomething =
      value.status !== undefined ||
      value.categoryId !== undefined ||
      value.brandId !== undefined ||
      value.addCollectionIds.length > 0 ||
      value.removeCollectionIds.length > 0 ||
      value.addTagIds.length > 0 ||
      value.removeTagIds.length > 0 ||
      value.price !== undefined;

    if (!touchesSomething) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: 'Choose at least one change to apply',
      });
    }
  });

export const productArchiveSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
  /** `false` restores an archived product to draft. */
  archived: z.boolean().default(true),
});

// --- variants & options -----------------------------------------------------

/**
 * Replaces the option sets and rebuilds the variant matrix — PRD F-AD-10
 * ("Color x Size -> auto-generate variants").
 *
 * A combination that already exists keeps its SKU, price, cost and stock. One that no
 * longer has a matching option value is deactivated rather than deleted, because it
 * may sit in a historical order.
 */
export const variantGenerateSchema = z.object({
  options: z.array(optionSetSchema).min(1).max(3),
  /** Seeds newly created combinations; existing ones keep what they had. */
  price: positiveMoneySchema,
  compareAtPrice: positiveMoneySchema.optional(),
  costPrice: positiveMoneySchema.default(0),
  weightGrams: z.coerce.number().int().min(0).max(50_000).default(0),
  /** Prefix for generated SKUs; the option values are appended. */
  skuPrefix: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[A-Za-z0-9._-]+$/, 'A SKU prefix takes letters, digits, dot, dash, underscore'),
});

export const variantsPatchSchema = z.object({
  variants: z.array(variantInputSchema).min(1).max(300),
});

export const variantReorderSchema = z.object({
  ids: z.array(idSchema).min(1).max(300),
});

export const priceScheduleInputSchema = z
  .object({
    variantIds: z.array(idSchema).min(1).max(300),
    price: positiveMoneySchema,
    compareAtPrice: positiveMoneySchema.nullable().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'The end must come after the start',
      });
    }
  });

// --- categories -------------------------------------------------------------

export const categoryPatchSchema = categoryInputSchema.partial().extend({
  published: z.boolean().optional(),
});

/**
 * One drag on the tree sends the node, its new parent and its new index. The API
 * rewrites the materialized `path` of the node and everything beneath it (D09).
 */
export const categoryMoveSchema = z.object({
  parentId: idSchema.nullable(),
  position: z.coerce.number().int().min(0),
});

export const categoryReorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema,
        parentId: idSchema.nullable(),
        position: z.coerce.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
});

// --- collections ------------------------------------------------------------

export const collectionPatchSchema = z.object({
  name: translatedSchema.optional(),
  slug: slugSchema.optional(),
  description: translatedOptionalSchema.optional(),
  isSmart: z.boolean().optional(),
  matchAll: z.boolean().optional(),
  rules: z.array(collectionRuleSchema).optional(),
  mediaId: idSchema.nullable().optional(),
  heroMediaId: idSchema.nullable().optional(),
  position: z.coerce.number().int().min(0).optional(),
  published: z.boolean().optional(),
  seoTitle: translatedOptionalSchema.optional(),
  seoDescription: translatedOptionalSchema.optional(),
});

/** Live preview under the rule builder: which products would this select today? */
export const collectionPreviewSchema = z.object({
  rules: z.array(collectionRuleSchema).min(1).max(20),
  matchAll: z.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const collectionProductsSchema = z.object({
  productIds: z.array(idSchema).min(1).max(500),
});

export const collectionReorderSchema = z.object({
  productIds: z.array(idSchema).min(1).max(500),
});

/** Pin, hide and boost inside one collection — PRD F-AD-13. */
export const merchandisingSchema = z.object({
  items: z
    .array(
      z.object({
        productId: idSchema,
        pinned: z.boolean().optional(),
        hidden: z.boolean().optional(),
        boost: z.coerce.number().int().min(-100).max(100).optional(),
        position: z.coerce.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const synonymInputSchema = z.object({
  term: z.string().trim().min(2).max(80).toLowerCase(),
  synonyms: z
    .array(z.string().trim().min(2).max(80).toLowerCase())
    .min(1, 'Add at least one synonym')
    .max(20),
  twoWay: z.boolean().default(true),
  active: z.boolean().default(true),
});

// --- brands, tags, attributes, size guides ----------------------------------

export const brandInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: translatedOptionalSchema.optional(),
  logoMediaId: idSchema.nullable().optional(),
});

export const tagInputSchema = z.object({
  name: translatedSchema,
  slug: slugSchema.max(64),
});

export const attributeInputSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, 'A key is lowercase letters, digits and underscores'),
    name: translatedSchema,
    kind: z.enum(['text', 'number', 'select']).default('text'),
    /** Allowed values when `kind` is `select`. */
    options: z.array(translatedSchema).optional(),
    filterable: z.boolean().default(true),
    position: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'select' && (value.options ?? []).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'A select attribute needs its list of values',
      });
    }
  });

export const sizeGuideInputSchema = z.object({
  name: translatedSchema,
  /** Rich HTML per locale, rendered on the product page. */
  body: translatedSchema,
  categoryId: idSchema.nullable().optional(),
});

// --- reviews ----------------------------------------------------------------

export const reviewListQuerySchema = adminListQuerySchema;

export interface ReviewListFilters {
  status?: string[];
  rating?: string[];
  productId?: string[];
  verified?: string[];
}

export const reviewModerationSchema = z.object({
  ids: z.array(idSchema).min(1, 'Select at least one review').max(200),
  status: z.enum([ReviewStatus.APPROVED, ReviewStatus.REJECTED, ReviewStatus.PENDING]),
});

export const reviewReplySchema = z.object({
  /** An empty string clears an earlier reply. */
  reply: z.string().trim().max(2000),
});

// --- import -----------------------------------------------------------------

/** Columns the product importer understands. The first row must name them. */
export const IMPORT_COLUMNS = [
  'sku',
  'name_fr',
  'name_ar',
  'name_en',
  'slug',
  'status',
  'brand',
  'category',
  'tags',
  'price',
  'compare_at_price',
  'cost_price',
  'weight_grams',
  'barcode',
  'short_description_fr',
  'description_fr',
] as const;

export const REQUIRED_IMPORT_COLUMNS = ['sku', 'name_fr', 'price'] as const;

export const productImportOptionsSchema = z.object({
  /** Validates and reports without writing anything. */
  dryRun: z.coerce.boolean().default(true),
  /** A row whose SKU already exists updates that variant instead of being skipped. */
  updateExisting: z.coerce.boolean().default(true),
});

export interface ImportIssue {
  /** 1-based row number as the operator sees it in the spreadsheet. */
  row: number;
  column: string | null;
  message: string;
}

export interface ImportReport {
  fileName: string;
  dryRun: boolean;
  totalRows: number;
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  skipped: number;
  issues: ImportIssue[];
}

/** Rows beyond this are refused; an import that big belongs in a background job. */
export const IMPORT_MAX_ROWS = 5_000;

// --- DTOs -------------------------------------------------------------------

export interface ProductRow {
  id: string;
  name: Translated;
  slug: string;
  status: ProductStatus;
  brandName: string | null;
  categoryName: Translated | null;
  thumbnailUrl: string | null;
  variantCount: number;
  /** Minor units as decimal strings — JSON has no bigint. */
  minPrice: string;
  maxPrice: string;
  maxCompareAt: string | null;
  totalStock: number;
  lowStockThreshold: number;
  ratingAverage: number;
  ratingCount: number;
  salesCount: number;
  collectionCount: number;
  mediaCount: number;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductMediaDto {
  mediaId: string;
  position: number;
  kind: string;
  url: string;
  posterUrl: string | null;
  fileName: string;
  alt: Translated | null;
  renditions: Rendition[];
  placeholderColor: string | null;
  processedAt: string | null;
}

export interface VariantDto {
  id: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  price: string;
  compareAtPrice: string | null;
  costPrice: string;
  weightGrams: number;
  position: number;
  active: boolean;
  optionValueIds: string[];
  mediaIds: string[];
  /** Summed across locations, so the editor shows stock without a second call. */
  stock: number;
  /** Null when there is no cost to compare against. */
  marginPercent: number | null;
}

export interface ProductOptionDto {
  id: string;
  name: Translated;
  kind: string;
  position: number;
  values: Array<{
    id: string;
    name: Translated;
    swatchHex: string | null;
    mediaId: string | null;
    position: number;
  }>;
}

export interface PriceScheduleDto {
  id: string;
  variantId: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  startsAt: string;
  endsAt: string | null;
  appliedAt: string | null;
  revertedAt: string | null;
}

export interface ProductDetail {
  id: string;
  name: Translated;
  slug: string;
  description: Translated | null;
  shortDescription: Translated | null;
  status: ProductStatus;
  brandId: string | null;
  categoryId: string | null;
  sizeGuideId: string | null;
  styleLabel: string | null;
  seoTitle: Translated | null;
  seoDescription: Translated | null;
  publishedAt: string | null;
  archivedAt: string | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  lowStockThreshold: number;
  shippingClass: string | null;
  minPrice: string;
  maxPrice: string;
  totalStock: number;
  ratingAverage: number;
  ratingCount: number;
  salesCount: number;
  collectionIds: string[];
  tagIds: string[];
  relatedProductIds: string[];
  attributes: Array<{ key: string; value: Translated }>;
  media: ProductMediaDto[];
  options: ProductOptionDto[];
  variants: VariantDto[];
  priceSchedules: PriceScheduleDto[];
  /** "Notify me" sign-ups still waiting — PRD F-AD-10. */
  stockNotificationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryNode {
  id: string;
  name: Translated;
  slug: string;
  parentId: string | null;
  path: string;
  depth: number;
  position: number;
  published: boolean;
  mediaId: string | null;
  mediaUrl: string | null;
  seoTitle: Translated | null;
  seoDescription: Translated | null;
  description: Translated | null;
  /** Products pointing directly at this node, not at its descendants. */
  productCount: number;
  children: CategoryNode[];
}

export interface CollectionRow {
  id: string;
  name: Translated;
  slug: string;
  isSmart: boolean;
  matchAll: boolean;
  published: boolean;
  position: number;
  ruleCount: number;
  /** Manual members, or the live match count for a smart collection. */
  productCount: number;
  mediaUrl: string | null;
  updatedAt: string;
}

export interface CollectionDetail extends Omit<CollectionRow, 'ruleCount'> {
  description: Translated | null;
  seoTitle: Translated | null;
  seoDescription: Translated | null;
  mediaId: string | null;
  heroMediaId: string | null;
  heroUrl: string | null;
  rules: Array<{ id: string; field: string; operator: string; value: string }>;
}

export interface MerchandisingItem {
  productId: string;
  name: Translated;
  slug: string;
  thumbnailUrl: string | null;
  status: ProductStatus;
  minPrice: string;
  totalStock: number;
  salesCount: number;
  position: number;
  pinned: boolean;
  hidden: boolean;
  boost: number;
}

export interface ReviewRow {
  id: string;
  productId: string;
  productName: Translated;
  productSlug: string;
  thumbnailUrl: string | null;
  customerId: string | null;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  status: ReviewStatus;
  verified: boolean;
  reply: string | null;
  repliedAt: string | null;
  helpfulCount: number;
  mediaUrls: string[];
  createdAt: string;
}

export interface BrandDto {
  id: string;
  name: string;
  slug: string;
  description: Translated | null;
  logoMediaId: string | null;
  logoUrl: string | null;
  productCount: number;
}

export interface TagDto {
  id: string;
  name: Translated;
  slug: string;
  productCount: number;
}

export interface AttributeDto {
  id: string;
  key: string;
  name: Translated;
  kind: string;
  options: Translated[] | null;
  filterable: boolean;
  position: number;
  productCount: number;
}

export interface SizeGuideDto {
  id: string;
  name: Translated;
  body: Translated;
  categoryId: string | null;
  categoryName: Translated | null;
  productCount: number;
}

export interface SynonymDto {
  id: string;
  term: string;
  synonyms: string[];
  twoWay: boolean;
  active: boolean;
}

export const CATALOG_ERRORS = {
  SLUG_TAKEN: 'That slug is already used by another entry',
  SKU_TAKEN: 'That SKU is already used',
  CATEGORY_CYCLE: 'A category cannot be moved inside its own subtree',
  CATEGORY_HAS_CHILDREN: 'Move or delete the sub-categories first',
  IN_USE: 'Something still points at this entry',
  SMART_COLLECTION_MANUAL: 'A smart collection is filled by its rules, not by hand',
  LAST_VARIANT: 'A product needs at least one variant',
} as const;

export type ProductPatchInput = z.infer<typeof productPatchSchema>;
export type ProductBulkUpdateInput = z.infer<typeof productBulkUpdateSchema>;
export type ProductDuplicateInput = z.infer<typeof productDuplicateSchema>;
export type VariantGenerateInput = z.infer<typeof variantGenerateSchema>;
export type VariantsPatchInput = z.infer<typeof variantsPatchSchema>;
export type PriceScheduleInput = z.infer<typeof priceScheduleInputSchema>;
export type CategoryPatchInput = z.infer<typeof categoryPatchSchema>;
export type CategoryMoveInput = z.infer<typeof categoryMoveSchema>;
export type CategoryReorderInput = z.infer<typeof categoryReorderSchema>;
export type CollectionPatchInput = z.infer<typeof collectionPatchSchema>;
export type CollectionPreviewInput = z.infer<typeof collectionPreviewSchema>;
export type MerchandisingInput = z.infer<typeof merchandisingSchema>;
export type SynonymInput = z.infer<typeof synonymInputSchema>;
export type BrandInput = z.infer<typeof brandInputSchema>;
export type TagInput = z.infer<typeof tagInputSchema>;
export type AttributeInput = z.infer<typeof attributeInputSchema>;
export type SizeGuideInput = z.infer<typeof sizeGuideInputSchema>;
export type ReviewModerationInput = z.infer<typeof reviewModerationSchema>;
export type ProductImportOptions = z.infer<typeof productImportOptionsSchema>;
