import { z } from 'zod';
import { MediaKind, ProductStatus } from '../enums/index.js';
import {
  idSchema,
  moneyAmountSchema,
  positiveMoneySchema,
  slugSchema,
  translatedOptionalSchema,
  translatedSchema,
} from './common.js';

/** PRD F-AD-10 — the product editor payload. */
export const variantInputSchema = z.object({
  id: idSchema.optional(),
  sku: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'SKU may contain letters, digits, dot, dash and underscore'),
  barcode: z.string().trim().max(64).optional(),
  price: positiveMoneySchema,
  compareAtPrice: positiveMoneySchema.optional(),
  costPrice: positiveMoneySchema.default(0),
  weightGrams: z.coerce.number().int().min(0).max(50_000).default(0),
  optionValueIds: z.array(idSchema).default([]),
  mediaIds: z.array(idSchema).default([]),
  position: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export const productAttributeSchema = z.object({
  key: z.string().trim().min(1).max(64),
  value: translatedSchema,
});

/**
 * The plain object half of the product payload. Split out from the refinement below
 * because `.partial()` does not exist on a refined schema, and the editor's autosave
 * sends whatever the operator has touched so far.
 */
export const productInputBase = z.object({
  name: translatedSchema,
  slug: slugSchema,
  description: translatedOptionalSchema.optional(),
  shortDescription: translatedOptionalSchema.optional(),
  status: z.nativeEnum(ProductStatus).default(ProductStatus.DRAFT),
  brandId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  collectionIds: z.array(idSchema).default([]),
  tagIds: z.array(idSchema).default([]),
  styleLabel: z.string().trim().max(64).optional(),
  sizeGuideId: idSchema.nullable().optional(),
  attributes: z.array(productAttributeSchema).default([]),
  seoTitle: translatedOptionalSchema.optional(),
  seoDescription: translatedOptionalSchema.optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  allowBackorder: z.boolean().default(false),
  trackInventory: z.boolean().default(true),
  shippingClass: z.string().trim().max(64).optional(),
  relatedProductIds: z.array(idSchema).default([]),
  mediaIds: z.array(idSchema).default([]),
  variants: z.array(variantInputSchema).min(1, 'A product needs at least one variant'),
});

/** Everything a product write must satisfy, whole-entity. */
export const productSuperRefine: (
  value: {
    variants: Array<{ sku: string; price: bigint; compareAtPrice?: bigint | undefined }>;
  },
  ctx: z.RefinementCtx,
) => void = (value, ctx) => {
  const skus = value.variants.map((v) => v.sku.toLowerCase());
  const duplicate = skus.find((sku, i) => skus.indexOf(sku) !== i);
  if (duplicate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['variants'],
      message: `Duplicate SKU "${duplicate}" within the product`,
    });
  }
  value.variants.forEach((variant, index) => {
    if (variant.compareAtPrice != null && variant.compareAtPrice <= variant.price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variants', index, 'compareAtPrice'],
        message: 'Compare-at price must be higher than the selling price',
      });
    }
  });
};

export const productInputSchema = productInputBase.superRefine(productSuperRefine);

export const optionSetSchema = z.object({
  name: translatedSchema,
  position: z.coerce.number().int().min(0).default(0),
  values: z
    .array(
      z.object({
        id: idSchema.optional(),
        name: translatedSchema,
        /** Hex swatch for colour options — drives the PDP colour chips (F-ST-31). */
        swatchHex: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        position: z.coerce.number().int().min(0).default(0),
      }),
    )
    .min(1),
});

export const categoryInputSchema = z.object({
  name: translatedSchema,
  slug: slugSchema,
  description: translatedOptionalSchema.optional(),
  parentId: idSchema.nullable().optional(),
  position: z.coerce.number().int().min(0).default(0),
  mediaId: idSchema.nullable().optional(),
  seoTitle: translatedOptionalSchema.optional(),
  seoDescription: translatedOptionalSchema.optional(),
});

/** Smart-collection rules — PRD F-AD-11. */
export const collectionRuleSchema = z.object({
  field: z.enum(['TAG', 'CATEGORY', 'BRAND', 'PRICE', 'DISCOUNT', 'STOCK', 'CREATED_AT', 'TITLE']),
  operator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GREATER_THAN', 'LESS_THAN', 'IN']),
  value: z.string().min(1).max(240),
});

export const collectionInputBase = z.object({
  name: translatedSchema,
  slug: slugSchema,
  description: translatedOptionalSchema.optional(),
  isSmart: z.boolean().default(false),
  matchAll: z.boolean().default(true),
  rules: z.array(collectionRuleSchema).default([]),
  productIds: z.array(idSchema).default([]),
  mediaId: idSchema.nullable().optional(),
  position: z.coerce.number().int().min(0).default(0),
  published: z.boolean().default(true),
});

export const collectionSuperRefine: (
  value: { isSmart: boolean; rules: unknown[] },
  ctx: z.RefinementCtx,
) => void = (value, ctx) => {
  if (value.isSmart && value.rules.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rules'],
      message: 'A smart collection needs at least one rule',
    });
  }
};

export const collectionInputSchema = collectionInputBase.superRefine(collectionSuperRefine);

export const mediaUploadSchema = z.object({
  kind: z.nativeEnum(MediaKind).default(MediaKind.IMAGE),
  alt: translatedOptionalSchema.optional(),
  folderId: idSchema.nullable().optional(),
});

/** Storefront listing query — PRD F-ST-21 / F-ST-22, all filters URL-persisted. */
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  collection: z.string().max(96).optional(),
  category: z.string().max(96).optional(),
  brand: z.array(z.string().max(96)).or(z.string().max(96)).optional(),
  color: z.array(z.string().max(96)).or(z.string().max(96)).optional(),
  size: z.array(z.string().max(96)).or(z.string().max(96)).optional(),
  material: z.array(z.string().max(96)).or(z.string().max(96)).optional(),
  tag: z.array(z.string().max(96)).or(z.string().max(96)).optional(),
  minPrice: moneyAmountSchema.optional(),
  maxPrice: moneyAmountSchema.optional(),
  inStock: z.coerce.boolean().optional(),
  onSale: z.coerce.boolean().optional(),
  sort: z
    .enum([
      'relevance',
      'best_selling',
      'newest',
      'price_asc',
      'price_desc',
      'name_asc',
      'name_desc',
      'discount',
    ])
    .default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(60).default(24),
});

export const reviewInputSchema = z.object({
  productId: idSchema,
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, 'Tell us a little more').max(2000),
  authorName: z.string().trim().min(2).max(80),
  mediaIds: z.array(idSchema).max(5).default([]),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;
export type CollectionInput = z.infer<typeof collectionInputSchema>;
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type CollectionRule = z.infer<typeof collectionRuleSchema>;
