import type {
  AdSpendInput,
  AdSpendRow,
  AdSpendSummary,
  ExpenseCategoryDto,
  ExpenseCategoryInput,
  ExpenseInput,
  ExpenseRow,
  LedgerBalances,
  LedgerEntryInput,
  PnlGrouping,
  PnlReport,
  ReportKey,
  ReportResult,
} from '@jecks/shared';
import { api } from '@/lib/api';

/** Every call the finance and report screens make — PRD F-AD-70 to F-AD-81. */

// --- expenses ---------------------------------------------------------------

export const listCategories = () =>
  api<ExpenseCategoryDto[]>('/admin/finance/expenses/categories');

export const createCategory = (body: ExpenseCategoryInput | Record<string, unknown>) =>
  api<ExpenseCategoryDto>('/admin/finance/expenses/categories', { method: 'POST', body });

export const updateCategory = (
  id: string,
  body: ExpenseCategoryInput | Record<string, unknown>,
) => api<ExpenseCategoryDto>(`/admin/finance/expenses/categories/${id}`, { method: 'PATCH', body });

export const deleteCategory = (id: string) =>
  api<void>(`/admin/finance/expenses/categories/${id}`, { method: 'DELETE' });

export const createExpense = (body: ExpenseInput | Record<string, unknown>) =>
  api<ExpenseRow>('/admin/finance/expenses', { method: 'POST', body });

export const updateExpense = (id: string, body: ExpenseInput | Record<string, unknown>) =>
  api<ExpenseRow>(`/admin/finance/expenses/${id}`, { method: 'PATCH', body });

export const deleteExpense = (id: string) =>
  api<void>(`/admin/finance/expenses/${id}`, { method: 'DELETE' });

export const generateRecurring = () =>
  api<{ created: number }>('/admin/finance/expenses/generate-recurring', { method: 'POST' });

// --- ad spend ---------------------------------------------------------------

export const listAdSpend = (query: { from: string; to: string }) =>
  api<AdSpendRow[]>('/admin/finance/ad-spend', { query });

export const adSpendSummary = (query: { from: string; to: string }) =>
  api<AdSpendSummary>('/admin/finance/ad-spend/summary', { query });

export const saveAdSpend = (body: AdSpendInput | Record<string, unknown>) =>
  api<AdSpendRow>('/admin/finance/ad-spend', { method: 'POST', body });

export const deleteAdSpend = (id: string) =>
  api<void>(`/admin/finance/ad-spend/${id}`, { method: 'DELETE' });

// --- ledger -----------------------------------------------------------------

export const ledgerBalances = () => api<LedgerBalances>('/admin/finance/ledger/balances');

export const createLedgerEntry = (body: LedgerEntryInput | Record<string, unknown>) =>
  api<unknown>('/admin/finance/ledger', { method: 'POST', body });

// --- profit and loss --------------------------------------------------------

export const pnl = (query: {
  from: string;
  to: string;
  groupBy?: PnlGrouping;
  compare?: boolean;
}) =>
  api<PnlReport>('/admin/finance/pnl', {
    query: {
      from: query.from,
      to: query.to,
      groupBy: query.groupBy ?? 'day',
      compare: query.compare ? 'true' : 'false',
    },
  });

// --- reports ----------------------------------------------------------------

export const reportCatalogue = () =>
  api<Array<{ key: ReportKey; title: string; group: string }>>('/admin/reports');

export const runReport = (key: ReportKey, query: { from?: string; to?: string; limit?: number }) =>
  api<ReportResult>(`/admin/reports/${key}`, { query });
