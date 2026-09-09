import { z } from 'zod';
import { LOCALES } from '../enums/index.js';
import { isValidDzPhone, normalizeDzPhone } from '../phone/index.js';

/** UUID v7 ids are still RFC-4122 UUIDs, so the plain uuid check applies. */
export const idSchema = z.string().uuid();

export const localeSchema = z.enum(LOCALES as unknown as [string, ...string[]]);

/** JSONB translated field — at least the French value must be present. */
export const translatedSchema = z
  .object({
    fr: z.string().min(1, 'French value is required'),
    ar: z.string().optional(),
    en: z.string().optional(),
  })
  .strict();

export const translatedOptionalSchema = z
  .object({ fr: z.string().optional(), ar: z.string().optional(), en: z.string().optional() })
  .strict();

export const slugSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words joined by hyphens');

/** Money crosses the wire as a decimal string of minor units — JSON has no bigint. */
export const moneyAmountSchema = z
  .union([z.string().regex(/^-?\d+$/), z.number().int()])
  .transform((value) => BigInt(value));

export const positiveMoneySchema = moneyAmountSchema.refine(
  (value) => value >= 0n,
  'Amount cannot be negative',
);

export const dzPhoneSchema = z
  .string()
  .min(9)
  .max(20)
  .refine(isValidDzPhone, 'Enter a valid Algerian phone number (05, 06 or 07)')
  .transform(normalizeDzPhone);

export const emailSchema = z.string().email().max(255).toLowerCase();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(24),
  cursor: z.string().optional(),
});

export const sortSchema = z.object({
  sortBy: z.string().max(64).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((range) => !range.from || !range.to || range.from <= range.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

/** API envelope of PRD Section 10.3: `{ data, meta, error }`. */
export interface ApiMeta {
  page?: number;
  perPage?: number;
  total?: number;
  nextCursor?: string | null;
  [key: string]: unknown;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  data: T | null;
  meta?: ApiMeta;
  error?: ApiError;
}

export type Paginated<T> = { items: T[]; total: number; page: number; perPage: number };

export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
