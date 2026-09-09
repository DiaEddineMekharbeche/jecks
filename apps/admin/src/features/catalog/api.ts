import type {
  AttributeDto,
  AttributeInput,
  BrandDto,
  BrandInput,
  CategoryMoveInput,
  CategoryNode,
  CategoryPatchInput,
  CategoryReorderInput,
  CollectionDetail,
  CollectionPatchInput,
  CollectionPreviewInput,
  CollectionRow,
  ImportReport,
  MerchandisingInput,
  MerchandisingItem,
  PriceScheduleDto,
  PriceScheduleInput,
  ProductBulkUpdateInput,
  ProductDetail,
  ProductPatchInput,
  ProductRow,
  ReviewModerationInput,
  ReviewRow,
  SizeGuideDto,
  SizeGuideInput,
  SynonymDto,
  SynonymInput,
  TagDto,
  TagInput,
  VariantGenerateInput,
} from '@jecks/shared';
import { api, getAccessToken } from '@/lib/api';

/**
 * Every call the catalogue screens make — PRD F-AD-10 to F-AD-13.
 *
 * Keeping them in one file rather than inline in components is what lets the query
 * hooks next door stay a thin cache layer, and what makes the surface the admin uses
 * checkable against `docs/API.md` at a glance.
 */

// --- products ---------------------------------------------------------------

export const getProduct = (id: string) => api<ProductDetail>(`/admin/products/${id}`);

export const getProductCounts = (query: Record<string, string[]>) =>
  api<Record<string, number>>('/admin/products/counts', { query: toFilterQuery(query) });

export const createProduct = (body: unknown) =>
  api<ProductDetail>('/admin/products', { method: 'POST', body });

export const updateProduct = (id: string, body: ProductPatchInput | Record<string, unknown>) =>
  api<ProductDetail>(`/admin/products/${id}`, { method: 'PATCH', body });

export const duplicateProduct = (id: string) =>
  api<ProductDetail>(`/admin/products/${id}/duplicate`, {
    method: 'POST',
    body: { includeMedia: true, includeVariants: true },
  });

export const archiveProducts = (ids: string[], archived: boolean) =>
  api<{ updated: number }>('/admin/products/archive', {
    method: 'POST',
    body: { ids, archived },
  });

export const bulkUpdateProducts = (body: ProductBulkUpdateInput | Record<string, unknown>) =>
  api<{ updated: number }>('/admin/products/bulk', { method: 'PATCH', body });

export const deleteProducts = (ids: string[]) =>
  api<{ deleted: number; failed: Array<{ id: string; message: string }> }>(
    '/admin/products/delete',
    { method: 'POST', body: { ids } },
  );

export const generateVariants = (
  id: string,
  body: VariantGenerateInput | Record<string, unknown>,
) => api<ProductDetail>(`/admin/products/${id}/variants/generate`, { method: 'POST', body });

export const saveVariants = (id: string, variants: unknown[]) =>
  api<ProductDetail>(`/admin/products/${id}/variants`, { method: 'PATCH', body: { variants } });

export const reorderVariants = (id: string, ids: string[]) =>
  api<ProductDetail>(`/admin/products/${id}/variants/reorder`, { method: 'POST', body: { ids } });

export const schedulePrice = (id: string, body: PriceScheduleInput | Record<string, unknown>) =>
  api<PriceScheduleDto[]>(`/admin/products/${id}/price-schedules`, { method: 'POST', body });

export const cancelPriceSchedule = (id: string, scheduleId: string) =>
  api<void>(`/admin/products/${id}/price-schedules/${scheduleId}`, { method: 'DELETE' });

/**
 * The import is multipart, so it goes through `fetch` rather than the JSON helper. The
 * bearer token lives in memory, which is why the header is attached by hand.
 */
export async function importProducts(
  file: File,
  options: { dryRun: boolean; updateExisting: boolean },
): Promise<ImportReport> {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
  const url = new URL(`${base}/admin/products/import`, window.location.origin);
  url.searchParams.set('dryRun', String(options.dryRun));
  url.searchParams.set('updateExisting', String(options.updateExisting));

  const form = new FormData();
  form.append('file', file);

  const token = getAccessToken();
  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const payload = (await response.json().catch(() => null)) as {
    data?: ImportReport;
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message ?? "L'import a échoué");
  }
  return payload.data;
}

export function importTemplateUrl(format: 'csv' | 'xlsx'): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
  return `${base}/admin/products/import/template?format=${format}`;
}

/** Product lookup for the pickers: related products, collection members, merchandising. */
export const searchProducts = (q: string) =>
  api<ProductRow[]>('/admin/products', { query: { q, pageSize: 20, sort: 'updatedAt' } });

// --- categories -------------------------------------------------------------

export const getCategoryTree = () => api<CategoryNode[]>('/admin/categories');

export const createCategory = (body: CategoryPatchInput | Record<string, unknown>) =>
  api<CategoryNode>('/admin/categories', { method: 'POST', body });

export const updateCategory = (id: string, body: CategoryPatchInput | Record<string, unknown>) =>
  api<CategoryNode>(`/admin/categories/${id}`, { method: 'PATCH', body });

export const moveCategory = (id: string, body: CategoryMoveInput) =>
  api<CategoryNode[]>(`/admin/categories/${id}/move`, { method: 'POST', body });

export const reorderCategories = (body: CategoryReorderInput) =>
  api<CategoryNode[]>('/admin/categories/reorder', { method: 'POST', body });

export const deleteCategory = (id: string) =>
  api<void>(`/admin/categories/${id}`, { method: 'DELETE' });

// --- collections ------------------------------------------------------------

export const listCollections = () =>
  api<CollectionRow[]>('/admin/collections', {
    query: { pageSize: 100, sort: 'position', order: 'asc' },
  });

export const getCollection = (id: string) => api<CollectionDetail>(`/admin/collections/${id}`);

export const getCollectionMembers = (id: string) =>
  api<MerchandisingItem[]>(`/admin/collections/${id}/products`);

export const createCollection = (body: Record<string, unknown>) =>
  api<CollectionDetail>('/admin/collections', { method: 'POST', body });

export const updateCollection = (
  id: string,
  body: CollectionPatchInput | Record<string, unknown>,
) => api<CollectionDetail>(`/admin/collections/${id}`, { method: 'PATCH', body });

export const previewCollection = (body: CollectionPreviewInput | Record<string, unknown>) =>
  api<{ total: number; products: ProductRow[] }>('/admin/collections/preview', {
    method: 'POST',
    body,
  });

export const addCollectionProducts = (id: string, productIds: string[]) =>
  api<{ added: number }>(`/admin/collections/${id}/products`, {
    method: 'POST',
    body: { productIds },
  });

export const removeCollectionProducts = (id: string, productIds: string[]) =>
  api<{ removed: number }>(`/admin/collections/${id}/products/remove`, {
    method: 'POST',
    body: { productIds },
  });

export const reorderCollectionProducts = (id: string, productIds: string[]) =>
  api<MerchandisingItem[]>(`/admin/collections/${id}/products/reorder`, {
    method: 'POST',
    body: { productIds },
  });

export const merchandiseCollection = (
  id: string,
  body: MerchandisingInput | Record<string, unknown>,
) => api<MerchandisingItem[]>(`/admin/collections/${id}/merchandising`, { method: 'POST', body });

export const deleteCollection = (id: string) =>
  api<void>(`/admin/collections/${id}`, { method: 'DELETE' });

// --- brands, tags, attributes, size guides, synonyms ------------------------

export const listBrands = () => api<BrandDto[]>('/admin/brands');
export const createBrand = (body: BrandInput | Record<string, unknown>) =>
  api<BrandDto>('/admin/brands', { method: 'POST', body });
export const updateBrand = (id: string, body: BrandInput | Record<string, unknown>) =>
  api<BrandDto>(`/admin/brands/${id}`, { method: 'PATCH', body });
export const deleteBrand = (id: string) => api<void>(`/admin/brands/${id}`, { method: 'DELETE' });

export const listTags = () => api<TagDto[]>('/admin/tags');
export const createTag = (body: TagInput | Record<string, unknown>) =>
  api<TagDto>('/admin/tags', { method: 'POST', body });
export const updateTag = (id: string, body: TagInput | Record<string, unknown>) =>
  api<TagDto>(`/admin/tags/${id}`, { method: 'PATCH', body });
export const deleteTag = (id: string) => api<void>(`/admin/tags/${id}`, { method: 'DELETE' });

export const listAttributes = () => api<AttributeDto[]>('/admin/attributes');
export const createAttribute = (body: AttributeInput | Record<string, unknown>) =>
  api<AttributeDto>('/admin/attributes', { method: 'POST', body });
export const updateAttribute = (id: string, body: AttributeInput | Record<string, unknown>) =>
  api<AttributeDto>(`/admin/attributes/${id}`, { method: 'PATCH', body });
export const deleteAttribute = (id: string) =>
  api<void>(`/admin/attributes/${id}`, { method: 'DELETE' });

export const listSizeGuides = () => api<SizeGuideDto[]>('/admin/size-guides');
export const createSizeGuide = (body: SizeGuideInput | Record<string, unknown>) =>
  api<SizeGuideDto>('/admin/size-guides', { method: 'POST', body });
export const updateSizeGuide = (id: string, body: SizeGuideInput | Record<string, unknown>) =>
  api<SizeGuideDto>(`/admin/size-guides/${id}`, { method: 'PATCH', body });
export const deleteSizeGuide = (id: string) =>
  api<void>(`/admin/size-guides/${id}`, { method: 'DELETE' });

export const listSynonyms = () => api<SynonymDto[]>('/admin/search-synonyms');
export const createSynonym = (body: SynonymInput | Record<string, unknown>) =>
  api<SynonymDto>('/admin/search-synonyms', { method: 'POST', body });
export const updateSynonym = (id: string, body: SynonymInput | Record<string, unknown>) =>
  api<SynonymDto>(`/admin/search-synonyms/${id}`, { method: 'PATCH', body });
export const deleteSynonym = (id: string) =>
  api<void>(`/admin/search-synonyms/${id}`, { method: 'DELETE' });

// --- reviews ----------------------------------------------------------------

export const getReviewCounts = (query: Record<string, string[]>) =>
  api<Record<string, number>>('/admin/reviews/counts', { query: toFilterQuery(query) });

export const moderateReviews = (body: ReviewModerationInput | Record<string, unknown>) =>
  api<{ updated: number }>('/admin/reviews/moderate', { method: 'POST', body });

export const replyToReview = (id: string, reply: string) =>
  api<ReviewRow>(`/admin/reviews/${id}/reply`, { method: 'POST', body: { reply } });

export const deleteReview = (id: string) => api<void>(`/admin/reviews/${id}`, { method: 'DELETE' });

/** `{ status: ['PENDING'] }` -> `{ 'filter[status]': ['PENDING'] }`. */
function toFilterQuery(filters: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(filters).map(([key, values]) => [`filter[${key}]`, values]),
  );
}
