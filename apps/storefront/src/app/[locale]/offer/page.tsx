import type { Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { OfferProduct } from '@/components/offer-product';
import { apiGet } from '@/lib/api';
import { getDictionary } from '@/lib/dictionary';
import type { ProductCard, ProductDetail } from '@/lib/types';

/**
 * The page a sponsored advert points at: every product, each with its order form, on
 * one screen. Nothing to browse to and no cart — a shopper picks, fills in, orders.
 *
 * It is kept out of search results: it duplicates the product pages and exists for paid
 * traffic only.
 */
export const revalidate = 120;

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OfferPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);

  const cards = await apiGet<ProductCard[]>('/catalog/products', {
    query: { perPage: 24 },
    revalidate: 120,
    tags: ['products'],
  }).catch(() => [] as ProductCard[]);

  const products = (
    await Promise.all(
      cards.map((card) =>
        apiGet<ProductDetail>(`/catalog/products/${card.slug}`, {
          revalidate: 120,
          tags: ['products', `product:${card.slug}`],
        }).catch(() => null),
      ),
    )
  ).filter((product): product is ProductDetail => product !== null);

  return (
    <div className="shell flex flex-col gap-16 py-8">
      {products.map((product) => (
        <OfferProduct
          key={product.id}
          product={product}
          locale={locale}
          dictionary={dictionary}
          single={products.length === 1}
        />
      ))}
    </div>
  );
}
