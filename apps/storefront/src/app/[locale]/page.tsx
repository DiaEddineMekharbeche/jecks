import type { Locale } from '@jecks/shared';
import { Suspense } from 'react';
import { FilterRail, SortSelect } from '@/components/filter-rail';
import { Pagination } from '@/components/pagination';
import { ProductGrid } from '@/components/product-grid';
import { apiGet, apiGetWithMeta } from '@/lib/api';
import { fillCount, getDictionary } from '@/lib/dictionary';
import type { Facets, ProductCard } from '@/lib/types';

/**
 * The home page is the shop: every product, in a grid, with nothing in front of it.
 *
 * It used to be assembled from the home builder's sections (hero, rails, banners). A
 * shop with a handful of products got a page that listed none of them until somebody
 * configured those sections, and a product published in the admin appeared nowhere. The
 * grid needs no setup: publish a product and it is on this page.
 */
export const revalidate = 120;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function HomePage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: SearchParams;
}) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);

  // Passed straight through; the API's schema is the validator, as on a collection page.
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) query[key] = value;
  }

  const [{ data: products, meta }, facets] = await Promise.all([
    apiGetWithMeta<ProductCard[]>('/catalog/products', {
      query,
      revalidate: 120,
      tags: ['products'],
    }),
    apiGet<Facets>('/catalog/facets', { query, revalidate: 300, tags: ['products'] }),
  ]);

  const total = meta.total ?? products.length;

  return (
    <div className="shell py-10">
      <h1 className="mb-8 text-hero">{dictionary.nav.shop}</h1>

      <div className="flex flex-col gap-8 lg:flex-row">
        <Suspense fallback={<div className="lg:w-60" />}>
          <FilterRail facets={facets} locale={locale} dictionary={dictionary} />
        </Suspense>

        <div className="min-w-0 flex-1">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {fillCount(dictionary.listing.results, dictionary.listing.resultsOne, total)}
            </p>
            <Suspense fallback={null}>
              <SortSelect dictionary={dictionary} />
            </Suspense>
          </div>

          <ProductGrid products={products} locale={locale} dictionary={dictionary} />

          <Pagination
            page={meta.page ?? 1}
            totalPages={meta.totalPages ?? 1}
            dictionary={dictionary}
          />
        </div>
      </div>
    </div>
  );
}
