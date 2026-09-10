import type {
  InventorySummary,
  LocationDto,
  LocationInput,
  PurchaseOrderDto,
  PurchaseOrderInput,
  PurchaseOrderPatchInput,
  PurchaseOrderReceiveInput,
  StockAdjustInput,
  StockBulkAdjustInput,
  StockCountDto,
  StockCountEntryInput,
  StockCountStartInput,
  StockTransferInput,
  SupplierInput,
  SupplierRow,
  InventoryRow,
} from '@jecks/shared';
import { api, getAccessToken } from '@/lib/api';

/**
 * Every call the stock screens make — PRD F-AD-50 to F-AD-53.
 *
 * The lists themselves go through `useServerTable`; what lives here is everything the
 * table cannot express: the summary tiles, the write operations, and the two documents
 * an operator downloads.
 */

// --- locations --------------------------------------------------------------

export const listLocations = () => api<LocationDto[]>('/admin/locations');

export const createLocation = (body: LocationInput) =>
  api<LocationDto>('/admin/locations', { method: 'POST', body });

export const updateLocation = (id: string, body: LocationInput) =>
  api<LocationDto>(`/admin/locations/${id}`, { method: 'PATCH', body });

export const deleteLocation = (id: string) =>
  api<void>(`/admin/locations/${id}`, { method: 'DELETE' });

// --- stock ------------------------------------------------------------------

export const getInventorySummary = (filters: Record<string, string[]>) =>
  api<InventorySummary>('/admin/inventory/summary', { query: toFilterQuery(filters) });

export const adjustStock = (body: StockAdjustInput) =>
  api<InventoryRow>('/admin/inventory/adjust', { method: 'POST', body });

export const bulkAdjustStock = (body: StockBulkAdjustInput) =>
  api<{ updated: number }>('/admin/inventory/bulk-adjust', { method: 'POST', body });

export const transferStock = (body: StockTransferInput) =>
  api<InventoryRow>('/admin/inventory/transfer', { method: 'POST', body });

// --- suppliers --------------------------------------------------------------

export const listSupplierOptions = () =>
  api<Array<{ id: string; name: string }>>('/admin/suppliers/options');

export const createSupplier = (body: SupplierInput) =>
  api<SupplierRow>('/admin/suppliers', { method: 'POST', body });

export const updateSupplier = (id: string, body: SupplierInput) =>
  api<SupplierRow>(`/admin/suppliers/${id}`, { method: 'PATCH', body });

export const deleteSupplier = (id: string) =>
  api<void>(`/admin/suppliers/${id}`, { method: 'DELETE' });

// --- purchase orders --------------------------------------------------------

export const getPurchaseOrder = (id: string) =>
  api<PurchaseOrderDto>(`/admin/purchase-orders/${id}`);

export const getPurchaseOrderCounts = () =>
  api<Record<string, number>>('/admin/purchase-orders/counts');

export const createPurchaseOrder = (body: PurchaseOrderInput | Record<string, unknown>) =>
  api<PurchaseOrderDto>('/admin/purchase-orders', { method: 'POST', body });

export const updatePurchaseOrder = (
  id: string,
  body: PurchaseOrderPatchInput | Record<string, unknown>,
) => api<PurchaseOrderDto>(`/admin/purchase-orders/${id}`, { method: 'PATCH', body });

export const placePurchaseOrder = (id: string) =>
  api<PurchaseOrderDto>(`/admin/purchase-orders/${id}/place`, { method: 'POST' });

export const receivePurchaseOrder = (id: string, body: PurchaseOrderReceiveInput) =>
  api<PurchaseOrderDto>(`/admin/purchase-orders/${id}/receive`, { method: 'POST', body });

export const cancelPurchaseOrder = (id: string) =>
  api<PurchaseOrderDto>(`/admin/purchase-orders/${id}/cancel`, { method: 'POST' });

export const deletePurchaseOrder = (id: string) =>
  api<void>(`/admin/purchase-orders/${id}`, { method: 'DELETE' });

// --- stock counts -----------------------------------------------------------

export const getStockCount = (id: string) => api<StockCountDto>(`/admin/stock-counts/${id}`);

export const startStockCount = (body: StockCountStartInput | Record<string, unknown>) =>
  api<StockCountDto>('/admin/stock-counts', { method: 'POST', body });

export const enterStockCount = (id: string, body: StockCountEntryInput) =>
  api<StockCountDto>(`/admin/stock-counts/${id}/entries`, { method: 'PATCH', body });

export const applyStockCount = (id: string) =>
  api<StockCountDto>(`/admin/stock-counts/${id}/apply`, { method: 'POST' });

export const cancelStockCount = (id: string) =>
  api<StockCountDto>(`/admin/stock-counts/${id}/cancel`, { method: 'POST' });

export const deleteStockCount = (id: string) =>
  api<void>(`/admin/stock-counts/${id}`, { method: 'DELETE' });

/**
 * The variance report. Goes through fetch rather than a link because the download needs
 * the bearer token that only lives in memory.
 */
export async function downloadStockCountReport(
  id: string,
  name: string,
  format: 'csv' | 'xlsx',
): Promise<void> {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
  const token = getAccessToken();
  const response = await fetch(`${base}/admin/stock-counts/${id}/export?format=${format}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("L'export a échoué");

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `inventaire-${name}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function toFilterQuery(filters: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(filters)) {
    if (values.length > 0) out[`filter[${key}]`] = values;
  }
  return out;
}
