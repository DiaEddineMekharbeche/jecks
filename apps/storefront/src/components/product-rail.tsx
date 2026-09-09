import type { Locale } from '@jecks/shared';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Dictionary } from '@/lib/dictionary';
import type { ProductCard as ProductCardData } from '@/lib/types';
import { ProductCard } from './product-card';

/**
 * A titled row of product cards. `carousel` scrolls horizontally on small screens with
 * scroll snapping; `grid` wraps. Both keep keyboard order intact.
 */
export function ProductRail({
  title,
  href,
  products,
  locale,
  dictionary,
  layout = 'carousel',
  priority = false,
}: {
  title: string;
  href?: string;
  products: ProductCardData[];
  locale: Locale;
  dictionary: Dictionary;
  layout?: 'carousel' | 'grid';
  priority?: boolean;
}) {
  return (
    <section className="shell py-section">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-hero">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="flex shrink-0 items-center gap-1 text-sm text-muted transition-colors hover:text-brass"
          >
            {dictionary.listing.loadMore}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
        ) : null}
      </div>

      <div
        className={
          layout === 'grid'
            ? 'mt-8 grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4'
            : 'no-scrollbar -mx-gutter mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-gutter pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-x-4 lg:gap-y-10 lg:overflow-visible lg:px-0'
        }
      >
        {products.map((product, index) => (
          <div
            key={product.id}
            className={layout === 'grid' ? '' : 'w-[62vw] shrink-0 snap-start sm:w-[38vw] lg:w-auto'}
          >
            <ProductCard
              product={product}
              locale={locale}
              dictionary={dictionary}
              priority={priority && index < 2}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
