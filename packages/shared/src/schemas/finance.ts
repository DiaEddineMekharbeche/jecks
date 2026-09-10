import { z } from 'zod';
import type { Translated } from '../i18n/index.js';
import { idSchema, moneyAmountSchema, positiveMoneySchema, translatedSchema } from './common.js';

/**
 * Finance, reporting and the P&L — PRD F-AD-70 to F-AD-81.
 *
 * One rule shapes everything here: a figure is either something that happened, or it is
 * derived from things that happened. Nothing is stored twice, so a report can never
 * disagree with the orders behind it.
 */

// --- expenses ---------------------------------------------------------------

export const EXPENSE_RECURRENCES = ['monthly', 'weekly', 'yearly'] as const;
export type ExpenseRecurrence = (typeof EXPENSE_RECURRENCES)[number];

export const expenseCategoryInputSchema = z.object({
  name: translatedSchema,
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase words joined by hyphens'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'A hex colour, like #B8860B')
    .nullable()
    .optional(),
});

export type ExpenseCategoryInput = z.infer<typeof expenseCategoryInputSchema>;

export interface ExpenseCategoryDto {
  id: string;
  name: Translated;
  slug: string;
  color: string | null;
  expenseCount: number;
  totalMinor: string;
}

export const expenseInputSchema = z
  .object({
    categoryId: idSchema.nullable().optional(),
    label: z.string().trim().min(1).max(200),
    amount: positiveMoneySchema,
    incurredAt: z.coerce.date(),
    recurrence: z.enum(EXPENSE_RECURRENCES).nullable().optional(),
    recurrenceEndsAt: z.coerce.date().nullable().optional(),
    attachmentKey: z.string().trim().max(400).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (input) => !input.recurrenceEndsAt || input.recurrenceEndsAt >= input.incurredAt,
    { message: 'A series cannot end before it starts', path: ['recurrenceEndsAt'] },
  );

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export interface ExpenseRow {
  id: string;
  categoryId: string | null;
  categoryName: Translated | null;
  categoryColor: string | null;
  label: string;
  amountMinor: string;
  incurredAt: string;
  recurrence: ExpenseRecurrence | null;
  recurrenceEndsAt: string | null;
  /** Set on an occurrence generated from a recurring parent. */
  parentId: string | null;
  attachmentKey: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

// --- ad spend ---------------------------------------------------------------

export const AD_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'google', 'other'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const adSpendInputSchema = z.object({
  platform: z.enum(AD_PLATFORMS),
  campaign: z.string().trim().max(160).nullable().optional(),
  spentOn: z.coerce.date(),
  amount: positiveMoneySchema,
  impressions: z.coerce.number().int().min(0).nullable().optional(),
  clicks: z.coerce.number().int().min(0).nullable().optional(),
  note: z.string().trim().max(400).nullable().optional(),
});

export type AdSpendInput = z.infer<typeof adSpendInputSchema>;

export interface AdSpendRow {
  id: string;
  platform: AdPlatform;
  campaign: string | null;
  spentOn: string;
  amountMinor: string;
  impressions: number | null;
  clicks: number | null;
  note: string | null;
}

export interface AdSpendSummary {
  from: string;
  to: string;
  totalMinor: string;
  orders: number;
  revenueMinor: string;
  /** Revenue per dinar spent; null when nothing was spent. */
  roas: number | null;
  costPerOrderMinor: string | null;
  byPlatform: Array<{
    platform: AdPlatform;
    amountMinor: string;
    impressions: number;
    clicks: number;
    /** Orders attributed by the UTM source recorded on the order. */
    orders: number;
    revenueMinor: string;
    roas: number | null;
  }>;
  series: Array<{ date: string; amountMinor: string; revenueMinor: string }>;
}

// --- ledger -----------------------------------------------------------------

export const LEDGER_KINDS = [
  'sale',
  'cod_collection',
  'refund',
  'expense',
  'settlement',
  'adjustment',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_ACCOUNTS = ['cash', 'bank', 'courier', 'customer'] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export const ledgerEntryInputSchema = z.object({
  kind: z.enum(LEDGER_KINDS),
  account: z.enum(LEDGER_ACCOUNTS),
  /** Signed: positive is money in, negative is money out. */
  amount: moneyAmountSchema,
  orderId: idSchema.nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  note: z.string().trim().max(400).nullable().optional(),
});

export type LedgerEntryInput = z.infer<typeof ledgerEntryInputSchema>;

export interface LedgerRow {
  id: string;
  kind: LedgerKind;
  account: LedgerAccount;
  amountMinor: string;
  orderId: string | null;
  orderNumber: string | null;
  referenceType: string | null;
  occurredAt: string;
  note: string | null;
}

export interface LedgerBalances {
  /** Balance per account, in the order a cashier thinks about them. */
  accounts: Array<{ account: LedgerAccount; balanceMinor: string; entryCount: number }>;
  totalMinor: string;
}

// --- profit and loss --------------------------------------------------------

export const PNL_GROUPINGS = [
  'day',
  'week',
  'month',
  'product',
  'category',
  'collection',
  'wilaya',
  'channel',
  'courier',
] as const;
export type PnlGrouping = (typeof PNL_GROUPINGS)[number];

export const pnlQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(PNL_GROUPINGS).default('day'),
  /** Adds the same span immediately before, for comparison. */
  compare: z.coerce.boolean().default(false),
  format: z.enum(['csv', 'xlsx']).optional(),
});

export type PnlQuery = z.infer<typeof pnlQuerySchema>;

export interface PnlLine {
  revenueMinor: string;
  cogsMinor: string;
  shippingRevenueMinor: string;
  shippingCostMinor: string;
  discountsMinor: string;
  paymentFeesMinor: string;
  refundsMinor: string;
  expensesMinor: string;
  adSpendMinor: string;
  grossProfitMinor: string;
  shippingMarginMinor: string;
  contributionMinor: string;
  netProfitMinor: string;
  grossMarginPercent: number;
  netMarginPercent: number;
}

export interface PnlGroupRow extends PnlLine {
  key: string;
  label: string;
  orders: number;
  units: number;
}

export interface PnlReport extends PnlLine {
  from: string;
  to: string;
  groupBy: PnlGrouping;
  orders: number;
  units: number;
  /** How an order qualifies as revenue, so the number can be defended. */
  basis: 'delivered' | 'paid';
  rows: PnlGroupRow[];
  /** The same span immediately before, when `compare` was asked for. */
  previous?: PnlLine & { from: string; to: string };
  changes?: {
    revenuePercent: number | null;
    netProfitPercent: number | null;
    ordersPercent: number | null;
  };
}

// --- reports ----------------------------------------------------------------

/**
 * Every report the library offers — PRD Section 5.9.
 *
 * Named rather than free-form: a report key is a contract with the export job and with
 * whoever scheduled it, and a query builder that takes arbitrary SQL is a different
 * product with a different security model.
 */
export const REPORT_KEYS = [
  'sales.by_product',
  'sales.by_variant',
  'sales.by_category',
  'sales.by_collection',
  'sales.by_period',
  'sales.by_wilaya',
  'sales.by_courier',
  'sales.by_source',
  'sales.by_agent',
  'inventory.valuation',
  'inventory.ageing',
  'inventory.stockouts',
  'customers.cohorts',
  'customers.retention',
  'promotions.performance',
  'search.zero_results',
  'funnel.conversion',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  format: z.enum(['csv', 'xlsx']).optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface ReportColumn {
  key: string;
  label: string;
  /** How the admin should render it, without having to know the report. */
  type: 'text' | 'number' | 'money' | 'percent' | 'date';
}

export interface ReportResult {
  key: ReportKey;
  title: string;
  from: string | null;
  to: string | null;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** A chartable series when the report has one; the table always stands alone. */
  series?: Array<{ label: string; value: number }>;
  /** True when the answer was cut off by `limit`. */
  truncated: boolean;
}

export const REPORT_EXPORT_STATUSES = ['pending', 'running', 'ready', 'failed'] as const;
export type ReportExportStatus = (typeof REPORT_EXPORT_STATUSES)[number];

export interface ReportExportRow {
  id: string;
  report: ReportKey;
  format: 'csv' | 'xlsx';
  status: ReportExportStatus;
  rowCount: number;
  error: string | null;
  requestedByName: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Present once the file exists and has not expired. */
  downloadUrl: string | null;
}

// --- errors -----------------------------------------------------------------

export const FINANCE_ERRORS = {
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  EXPENSE_LOCKED: 'EXPENSE_LOCKED',
  PERIOD_TOO_LONG: 'PERIOD_TOO_LONG',
  UNKNOWN_REPORT: 'UNKNOWN_REPORT',
  EXPORT_NOT_READY: 'EXPORT_NOT_READY',
} as const;

export type FinanceErrorCode = (typeof FINANCE_ERRORS)[keyof typeof FINANCE_ERRORS];

/** The longest span a report may cover in one request. */
export const MAX_REPORT_DAYS = 400;
