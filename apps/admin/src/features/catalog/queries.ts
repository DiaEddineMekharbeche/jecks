import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import * as catalog from './api';

/**
 * Cache layer for the catalogue screens.
 *
 * The vocabularies — categories, collections, brands, tags, attributes, size guides —
 * are small, change rarely and are read by nearly every screen, so they share a five
 * minute stale time and one invalidation helper. Products and reviews go through
 * `useServerTable`, which owns its own keys.
 */

export const catalogKeys = {
  all: ['admin', 'catalog'] as const,
  product: (id: string) => ['admin', 'catalog', 'product', id] as const,
  categories: ['admin', 'catalog', 'categories'] as const,
  collections: ['admin', 'catalog', 'collections'] as const,
  collection: (id: string) => ['admin', 'catalog', 'collection', id] as const,
  members: (id: string) => ['admin', 'catalog', 'collection', id, 'products'] as const,
  brands: ['admin', 'catalog', 'brands'] as const,
  tags: ['admin', 'catalog', 'tags'] as const,
  attributes: ['admin', 'catalog', 'attributes'] as const,
  sizeGuides: ['admin', 'catalog', 'size-guides'] as const,
  synonyms: ['admin', 'catalog', 'synonyms'] as const,
};

const VOCABULARY_STALE_TIME = 5 * 60_000;

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.product(id ?? 'new'),
    queryFn: () => catalog.getProduct(id!),
    enabled: Boolean(id),
  });
}

export function useCategoryTree() {
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: catalog.getCategoryTree,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useCollections() {
  return useQuery({
    queryKey: catalogKeys.collections,
    queryFn: catalog.listCollections,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.collection(id ?? 'new'),
    queryFn: () => catalog.getCollection(id!),
    enabled: Boolean(id),
  });
}

export function useCollectionMembers(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.members(id ?? 'new'),
    queryFn: () => catalog.getCollectionMembers(id!),
    enabled: Boolean(id),
  });
}

export function useBrands() {
  return useQuery({
    queryKey: catalogKeys.brands,
    queryFn: catalog.listBrands,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useTags() {
  return useQuery({
    queryKey: catalogKeys.tags,
    queryFn: catalog.listTags,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useAttributes() {
  return useQuery({
    queryKey: catalogKeys.attributes,
    queryFn: catalog.listAttributes,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useSizeGuides() {
  return useQuery({
    queryKey: catalogKeys.sizeGuides,
    queryFn: catalog.listSizeGuides,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

export function useSynonyms() {
  return useQuery({
    queryKey: catalogKeys.synonyms,
    queryFn: catalog.listSynonyms,
    staleTime: VOCABULARY_STALE_TIME,
  });
}

/**
 * One invalidator for the whole feature. A product write can change a collection's
 * count, a category's count and the product list at once, so screens invalidate the
 * subtree rather than trying to name every key a change touched.
 */
export function useCatalogInvalidate() {
  const queryClient = useQueryClient();

  return useCallback(
    (...keys: readonly unknown[][]) => {
      const targets = keys.length > 0 ? keys : [catalogKeys.all, ['admin', 'products']];
      for (const queryKey of targets) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient],
  );
}
