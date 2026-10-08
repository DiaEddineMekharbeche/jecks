'use client';

import type { Locale } from '@jecks/shared';
import { OfferOrderForm } from './offer-order-form';
import { ProductPurchase } from './product-purchase';
import type { Dictionary } from '@/lib/dictionary';
import type { ProductDetail } from '@/lib/types';

/** One product of the advert page: its gallery and options, with the order form under them. */
export function OfferProduct({
  product,
  locale,
  dictionary,
  single,
}: {
  product: ProductDetail;
  locale: Locale;
  dictionary: Dictionary;
  /** The page is about this one product, so it owns the h1. */
  single: boolean;
}) {
  return (
    <section id={product.slug} className="scroll-mt-6">
      <ProductPurchase
        product={product}
        locale={locale}
        dictionary={dictionary}
        heading={single ? 'h1' : 'h2'}
        renderActions={(choice) => (
          <OfferOrderForm {...choice} locale={locale} dictionary={dictionary} />
        )}
      />
    </section>
  );
}
