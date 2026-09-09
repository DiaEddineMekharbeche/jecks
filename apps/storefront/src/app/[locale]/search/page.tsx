import { t, type Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductGrid } from '@/components/product-grid';
import { SearchField } from '@/components/search-field';
import { apiGet } from '@/lib/api';
import { fill, getDictionary } from '@/lib/dictionary';
import type { CollectionSummary, ProductCard } from '@/lib/types';

export const metadata: Metadata = {
  // A search results page has no business in an index.
  robots: { index: false, follow: true },
};

interface SearchResponse {
  products: ProductCard[];
  collections: Array<Pick<CollectionSummary, 'slug' | 'name'>>;
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { q?: string };
}) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);
  const query = (searchParams.q ?? '').trim();

  const results = query
    ? await apiGet<SearchResponse>('/catalog/search', {
        query: { q: query },
        // Search results are personal and cheap to recompute; caching them helps nobody.
        revalidate: 0,
      }).catch(() => ({ products: [], collections: [] }))
    : { products: [], collections: [] };

  return (
    <div className="shell py-10">
      <h1 className="text-hero">{dictionary.nav.search}</h1>

      <div className="mt-6 max-w-xl">
        <SearchField locale={locale} dictionary={dictionary} defaultValue={query} />
      </div>

      {query ? (
        <>
          {results.collections.length > 0 ? (
            <section className="mt-10">
              <p className="eyebrow mb-3">{dictionary.search.collections}</p>
              <ul className="flex flex-wrap gap-2">
                {results.collections.map((collection) => (
                  <li key={collection.slug}>
                    <Link
                      href={`/${locale}/collections/${collection.slug}`}
                      className="rounded-sm border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-brass hover:text-brass"
                    >
                      {t(collection.name, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-10">
            <p className="eyebrow mb-4">{dictionary.search.products}</p>
            {results.products.length > 0 ? (
              <ProductGrid products={results.products} locale={locale} dictionary={dictionary} />
            ) : (
              <p className="text-sm text-muted">{fill(dictionary.search.noResults, { query })}</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
