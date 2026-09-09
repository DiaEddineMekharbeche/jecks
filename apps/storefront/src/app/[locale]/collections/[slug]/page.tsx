import { t, type Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { FilterRail, SortSelect } from '@/components/filter-rail';
import { Pagination } from '@/components/pagination';
import { ProductGrid } from '@/components/product-grid';
import { apiGet, apiGetWithMeta } from '@/lib/api';
import { fillCount, getDictionary } from '@/lib/dictionary';
import type { CollectionSummary, Facets, ProductCard } from '@/lib/types';

export const revalidate = 120;

type SearchParams = Record<string, string | string[] | undefined>;

async function loadCollection(slug: string): Promise<CollectionSummary | null> {
  const collections = await apiGet<CollectionSummary[]>('/catalog/collections', {
    revalidate: 600,
    tags: ['collections'],
  }).catch(() => [] as CollectionSummary[]);
  return collections.find((collection) => collection.slug === slug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const collection = await loadCollection(params.slug);
  if (!collection) return {};
  const locale = params.locale as Locale;
  return {
    title: t(collection.name, locale),
    description: t(collection.description, locale) || undefined,
    alternates: { canonical: `/${locale}/collections/${collection.slug}` },
  };
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: { locale: string; slug: string };
  searchParams: SearchParams;
}) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);

  const collection = await loadCollection(params.slug);
  if (!collection) notFound();

  const query = { ...toQuery(searchParams), collection: params.slug };

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
      <header className="mb-8 max-w-prose">
        <h1 className="text-hero">{t(collection.name, locale)}</h1>
        {collection.description ? (
          <p className="mt-3 text-muted">{t(collection.description, locale)}</p>
        ) : null}
      </header>

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

/** Passes the URL query straight through; the API's Zod schema is the validator. */
function toQuery(searchParams: SearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
