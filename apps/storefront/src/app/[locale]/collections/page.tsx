import { t, type Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { getDictionary } from '@/lib/dictionary';
import type { CollectionSummary } from '@/lib/types';

export const revalidate = 600;

/**
 * Every collection, in one place.
 *
 * The home page's hero has always linked here and there was no page to land on. A
 * shopper who wants to browse by theme rather than by category needs somewhere to see
 * what the themes are.
 */

async function loadCollections(): Promise<CollectionSummary[]> {
  return apiGet<CollectionSummary[]>('/catalog/collections', {
    revalidate: 600,
    tags: ['collections'],
  }).catch(() => [] as CollectionSummary[]);
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);

  return {
    title: dictionary.nav.collections,
    alternates: { canonical: `/${locale}/collections` },
  };
}

export default async function CollectionsPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);
  const collections = await loadCollections();

  return (
    <div className="shell py-10">
      <header className="mb-8 max-w-prose">
        <h1 className="text-hero">{dictionary.nav.collections}</h1>
      </header>

      {collections.length === 0 ? (
        <p className="text-muted">{dictionary.listing.empty}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link
                href={`/${locale}/collections/${collection.slug}`}
                className="group flex h-full flex-col justify-between rounded-sm border border-line p-5 transition-colors hover:border-brass"
              >
                <span className="text-lg font-medium text-ink group-hover:text-brass">
                  {t(collection.name, locale)}
                </span>
                {collection.description ? (
                  <span className="mt-2 text-sm text-muted">
                    {t(collection.description, locale)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
