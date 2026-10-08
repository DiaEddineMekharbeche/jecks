import { t, type Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OfferProduct } from '@/components/offer-product';
import { apiGet, mediaUrl } from '@/lib/api';
import { getDictionary } from '@/lib/dictionary';
import type { ProductDetail } from '@/lib/types';

/** One product's advert page — the link a single sponsored ad points at. */
export const revalidate = 120;

function load(slug: string): Promise<ProductDetail | null> {
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
  const product = await load(params.slug);
  if (!product) return {};
  const locale = params.locale as Locale;
  const image = mediaUrl(product.media[0]?.media.storageKey);

  return {
    title: t(product.name, locale),
    robots: { index: false, follow: false },
    openGraph: {
      title: t(product.name, locale),
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function OfferProductPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const locale = params.locale as Locale;
  const product = await load(params.slug);
  if (!product) notFound();

  return (
    <div className="shell py-8">
      <OfferProduct product={product} locale={locale} dictionary={getDictionary(locale)} single />
    </div>
  );
}
