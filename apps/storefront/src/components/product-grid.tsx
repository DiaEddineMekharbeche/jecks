import type { Locale } from '@jecks/shared';
import type { Dictionary } from '@/lib/dictionary';
import type { ProductCard as ProductCardData } from '@/lib/types';
import { ProductCard } from './product-card';

/** Two columns on mobile, three to four on desktop — PRD F-ST-20. */
export function ProductGrid({
  products,
  locale,
  dictionary,
}: {
  products: ProductCardData[];
  locale: Locale;
  dictionary: Dictionary;
}) {
  if (products.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-line p-12 text-center text-sm text-muted">
        {dictionary.listing.empty}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          locale={locale}
          dictionary={dictionary}
          // Only the first row is worth pre-loading; the rest are below the fold.
          priority={index < 4}
        />
      ))}
    </div>
  );
}
