import type { BulkCodeInput, PromotionInput, PromotionSimulateInput } from '@jecks/shared';
import { api } from '@/lib/api';

/** Every call the promotion screens make — PRD F-AD-20/21. */

export interface PromotionRow {
  id: string;
  name: string;
  code: string | null;
  type: string;
  scope: string;
  state: 'draft' | 'scheduled' | 'active' | 'expired' | 'exhausted';
  percentOff: number | null;
  amountOffMinor: string | null;
  usageCount: number;
  usageLimitTotal: number | null;
  codeCount: number;
  grantedMinor: string;
  stackable: boolean;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface PromotionDetail extends PromotionRow {
  description: string | null;
  bundlePriceMinor: string | null;
  buyXGetY: { buyQuantity: number; getQuantity: number; getDiscountPercent: number } | null;
  tiers: Array<{ minSubtotalMinor: string; percentOff: number }>;
  minSubtotalMinor: string | null;
  minQuantity: number | null;
  firstOrderOnly: boolean;
  wilayaCodes: number[];
  productIds: string[];
  variantIds: string[];
  collectionIds: string[];
  categoryIds: string[];
  customerGroupIds: string[];
  usageLimitPerCustomer: number | null;
  showCountdown: boolean;
}

export interface SimulationResult {
  lines: Array<{
    id: string;
    sku: string;
    productName: Record<string, string>;
    quantity: number;
    unitPriceMinor: string;
    discountMinor: string;
  }>;
  applied: Array<{
    promotionId: string;
    name: string;
    code: string | null;
    amountMinor: string;
    freeShipping: boolean;
  }>;
  rejected: Array<{ code: string; reason: string; message: string }>;
  subtotalMinor: string;
  discountMinor: string;
  shippingMinor: string;
  totalMinor: string;
}

export interface PromotionPerformance {
  uses: number;
  deliveredUses: number;
  customers: number;
  grantedMinor: string;
  revenueMinor: string;
  marginMinor: string;
  averageOrderMinor: string;
  series: Array<{ date: string; uses: number; grantedMinor: string }>;
}

export const getPromotion = (id: string) => api<PromotionDetail>(`/admin/promotions/${id}`);

export const getPromotionCounts = () => api<Record<string, number>>('/admin/promotions/counts');

export const getPerformance = (id: string) =>
  api<PromotionPerformance>(`/admin/promotions/${id}/performance`);

export const listCodes = (id: string) =>
  api<Array<{ code: string; usageCount: number; usageLimit: number }>>(
    `/admin/promotions/${id}/codes`,
  );

export const createPromotion = (body: PromotionInput | Record<string, unknown>) =>
  api<PromotionDetail>('/admin/promotions', { method: 'POST', body });

export const updatePromotion = (id: string, body: PromotionInput | Record<string, unknown>) =>
  api<PromotionDetail>(`/admin/promotions/${id}`, { method: 'PATCH', body });

export const setPromotionActive = (id: string, active: boolean) =>
  api<PromotionDetail>(`/admin/promotions/${id}/activate`, { method: 'POST', body: { active } });

export const generateCodes = (id: string, body: BulkCodeInput | Record<string, unknown>) =>
  api<{ created: number; codes: string[] }>(`/admin/promotions/${id}/codes/generate`, {
    method: 'POST',
    body,
  });

export const deletePromotion = (id: string) =>
  api<void>(`/admin/promotions/${id}`, { method: 'DELETE' });

export const simulate = (body: PromotionSimulateInput | Record<string, unknown>) =>
  api<SimulationResult>('/admin/promotions/simulate', { method: 'POST', body });

export const searchVariants = (q: string) =>
  api<
    Array<{
      id: string;
      sku: string;
      productName: Record<string, string>;
      variantName: string | null;
      priceMinor: string;
    }>
  >('/admin/variants/search', { query: { q, limit: 20 } });
