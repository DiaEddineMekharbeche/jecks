import { t, type Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductPurchase } from '@/components/product-purchase';
import { ProductRail } from '@/components/product-rail';
import { ProductReviews } from '@/components/product-reviews';
import { apiGet, mediaUrl } from '@/lib/api';
import { getDictionary } from '@/lib/dictionary';
import type { ProductCard, ProductDetail } from '@/lib/types';

export const revalidate = 120;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

async function loadProduct(slug: string): Promise<ProductDetail | null> {
  return apiGet<ProductDetail>(`/catalog/products/${slug}`, {
    revalidate: 120,
    tags: ['products', `product:${slug}`],
  }).catch(() => null);
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const product = await loadProduct(params.slug);
  if (!product) return {};

  const locale = params.locale as Locale;
  const title = t(product.name, locale);
  const description =
    t(product.shortDescription, locale) || t(product.description, locale).slice(0, 155);
  const image = mediaUrl(product.media[0]?.media.storageKey);

  return {
    title,
    description,
    alternates: { canonical: `/${locale}/products/${product.slug}` },
    openGraph: {
      type: 'website',
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);

  const product = await loadProduct(params.slug);
  if (!product) notFound();

  // Same category, different product — the cross-sell rail of PRD F-ST-36.
  const related = await apiGet<ProductCard[]>('/catalog/products', {
    query: { category: product.category?.slug, perPage: 4, sort: 'best_selling' },
    revalidate: 300,
    tags: ['products'],
  })
    .then((items) => items.filter((item) => item.slug !== product.slug).slice(0, 4))
    .catch(() => [] as ProductCard[]);

  const attributes = [...product.attributes].sort(
    (a, b) => a.attribute.position - b.attribute.position,
  );

  return (
    <div className="shell py-10">
      <Breadcrumbs locale={locale} product={product} dictionary={dictionary} />

      <ProductPurchase product={product} locale={locale} dictionary={dictionary} />

      <div className="mt-16 grid gap-10 lg:grid-cols-2">
        {product.description ? (
          <section>
            <h2 className="text-2xl">{dictionary.product.description}</h2>
            <div
              className="prose-invert mt-4 max-w-prose text-muted"
              // Rich text written by staff in the admin editor, not by shoppers.
              dangerouslySetInnerHTML={{ __html: t(product.description, locale) }}
            />
          </section>
        ) : null}

        {attributes.length > 0 ? (
          <section>
            <h2 className="text-2xl">{dictionary.product.details}</h2>
            <dl className="mt-4 divide-y divide-line border-y border-line">
              {attributes.map((entry) => (
                <div key={entry.attribute.key} className="flex justify-between gap-4 py-3 text-sm">
                  <dt className="text-muted">{t(entry.attribute.name, locale)}</dt>
                  <dd className="text-end">{t(entry.value, locale)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>

      <ProductReviews productId={product.id} locale={locale} dictionary={dictionary} />

      {related.length > 0 ? (
        <ProductRail
          title={dictionary.product.relatedTitle}
          products={related}
          locale={locale}
          dictionary={dictionary}
          layout="grid"
        />
      ) : null}

      <ProductJsonLd product={product} locale={locale} />
    </div>
  );
}

function Breadcrumbs({
  locale,
  product,
  dictionary,
}: {
  locale: Locale;
  product: ProductDetail;
  dictionary: ReturnType<typeof getDictionary>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-8">
      <ol className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <li>
          <Link href={`/${locale}`} className="hover:text-ink">
            {dictionary.common.home}
          </Link>
        </li>
        {product.category ? (
          <>
            <li aria-hidden>/</li>
            <li>
              <Link
                href={`/${locale}/collections/${product.category.slug}`}
                className="hover:text-ink"
              >
                {t(product.category.name, locale)}
              </Link>
            </li>
          </>
        ) : null}
        <li aria-hidden>/</li>
        <li aria-current="page" className="text-ink">
          {t(product.name, locale)}
        </li>
      </ol>
    </nav>
  );
}

/** Product and Breadcrumb JSON-LD, required by PRD F-ST-05. */
function ProductJsonLd({ product, locale }: { product: ProductDetail; locale: Locale }) {
  const url = `${SITE_URL}/${locale}/products/${product.slug}`;
  const inStock = product.variants.some((variant) => variant.inStock);

  const json = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: t(product.name, locale),
    description: t(product.shortDescription, locale) || t(product.description, locale),
    sku: product.variants[0]?.sku,
    brand: { '@type': 'Brand', name: product.brand?.name ?? "Jeck's" },
    image: product.media.map((entry) => mediaUrl(entry.media.storageKey)).filter(Boolean),
    url,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'DZD',
      // JSON-LD prices are major units; the API speaks centimes.
      lowPrice: (Number(product.minPrice) / 100).toFixed(2),
      highPrice: (Number(product.maxPrice) / 100).toFixed(2),
      offerCount: product.variants.length,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url,
    },
    ...(product.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: Number(product.ratingAverage).toFixed(1),
            reviewCount: product.ratingCount,
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
