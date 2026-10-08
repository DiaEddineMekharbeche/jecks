'use client';

import type { Locale } from '@jecks/shared';
import { OfferOrderForm } from './offer-order-form';
import { ProductPurchase } from './product-purchase';
import type { Dictionary } from '@/lib/dictionary';
import type { ProductDetail } from '@/lib/types';

/** One product's advert page: its gallery and options, with the order form already open under them. */
export function OfferProduct({
  product,
  locale,
  dictionary,
}: {
  product: ProductDetail;
  locale: Locale;
  dictionary: Dictionary;
}) {
  return (
    <section>
      <ProductPurchase
        product={product}
        locale={locale}
        dictionary={dictionary}
        heading="h1"
        renderActions={(choice) => (
          <OfferOrderForm {...choice} startOpen locale={locale} dictionary={dictionary} />
        )}
      />
    </section>
  );
}
