import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import * as inventory from './api';

/**
 * Cache layer for the stock screens.
 *
 * Locations and supplier options are read by nearly every screen here and change once
 * a quarter, so they get a long stale time; everything that moves — levels, movements,
 * purchase orders — is invalidated wholesale after any write, because a receipt changes
 * four lists at once and guessing which ones would be a bug waiting to happen.
 */

export const inventoryKeys = {
  all: ['admin', 'inventory'] as const,
  locations: ['admin', 'inventory', 'locations'] as const,
  summary: (filters: unknown) => ['admin', 'inventory', 'summary', filters] as const,
  supplierOptions: ['admin', 'inventory', 'supplier-options'] as const,
  purchaseOrder: (id: string) => ['admin', 'inventory', 'purchase-order', id] as const,
  purchaseOrderCounts: ['admin', 'inventory', 'purchase-order-counts'] as const,
  stockCount: (id: string) => ['admin', 'inventory', 'stock-count', id] as const,
};

const VOCABULARY_STALE_TIME = 5 * 60_000;

export function useLocations() {
  return useQuery({
    queryKey: inventoryKeys.locations,
    queryFn: inventory.listLocations,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useSupplierOptions() {
  return useQuery({
    queryKey: inventoryKeys.supplierOptions,
    queryFn: inventory.listSupplierOptions,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useInventorySummary(filters: Record<string, string[]>) {
  return useQuery({
    queryKey: inventoryKeys.summary(filters),
    queryFn: () => inventory.getInventorySummary(filters),
    staleTime: 30_000,
  });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.purchaseOrder(id ?? 'new'),
    queryFn: () => inventory.getPurchaseOrder(id!),
    enabled: Boolean(id) && id !== 'new',
  });
}

export function usePurchaseOrderCounts() {
  return useQuery({
    queryKey: inventoryKeys.purchaseOrderCounts,
    queryFn: inventory.getPurchaseOrderCounts,
    staleTime: 30_000,
  });
}

export function useStockCount(id: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.stockCount(id ?? 'new'),
    queryFn: () => inventory.getStockCount(id!),
    enabled: Boolean(id) && id !== 'new',
  });
}

/** Invalidates everything stock-related; also nudges the catalogue's stock columns. */
export function useInventoryInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stock'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stock-movements'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'purchase-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stock-counts'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
  }, [queryClient]);
}
