import type { Locale } from '@jecks/shared';
import { OfferProduct } from './offer-product';
import { OfferShowcase } from './offer-showcase';
import { apiGet } from '@/lib/api';
import { getDictionary } from '@/lib/dictionary';
import type { ProductCard, ProductDetail } from '@/lib/types';

/**
 * Every active product with its order form on one screen. The home page and the advert
 * page (`/offer`) are this same page: what a shopper sees from an ad is what they see
 * when they open the shop.
 */
export async function OfferPage({ locale }: { locale: Locale }) {
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

  if (products.length === 0) return null;

  return (
    <div className="shell py-6">
      {products.length === 1 ? (
        <OfferProduct product={products[0]!} locale={locale} dictionary={dictionary} />
      ) : (
        <OfferShowcase products={products} locale={locale} dictionary={dictionary} />
      )}
    </div>
  );
}
