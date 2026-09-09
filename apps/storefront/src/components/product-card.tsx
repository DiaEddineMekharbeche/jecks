'use client';

import { discountPercent, format, money, t, type Locale } from '@jecks/shared';
import { Badge, cn } from '@jecks/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { Dictionary } from '@/lib/dictionary';
import type { ProductCard as ProductCardData } from '@/lib/types';
import { MediaImage } from './media-image';

/**
 * Product card of PRD F-ST-23: hover swaps to the second image, colour swatches change
 * the visible colourway, badges show NEW / -X % / SOLD OUT / LIMITED.
 */
export function ProductCard({
  product,
  locale,
  dictionary,
  priority = false,
}: {
  product: ProductCardData;
  locale: Locale;
  dictionary: Dictionary;
  priority?: boolean;
}) {
  const gallery = product.media.map((entry) => entry.media);
  const swatches = product.options[0]?.values ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovering, setHovering] = useState(false);

  const primary = gallery[activeIndex] ?? gallery[0];
  const secondary = gallery[(activeIndex + 1) % Math.max(gallery.length, 1)];
  const shown = hovering && gallery.length > 1 ? secondary : primary;

  const price = money(BigInt(product.minPrice));
  const compareAt = product.maxCompareAt ? money(BigInt(product.maxCompareAt)) : null;
  const discount = compareAt ? discountPercent(compareAt, price) : 0;
  const soldOut = product.totalStock <= 0;

  const tagSlugs = new Set(product.tags.map((entry) => entry.tag.slug));
  const isNew =
    product.publishedAt != null &&
    Date.now() - new Date(product.publishedAt).getTime() < 30 * 86_400_000;

  return (
    <article className="card-lift group">
      <Link href={`/${locale}/products/${product.slug}`} className="block">
        <div
          className="relative aspect-[4/5] overflow-hidden rounded-sm bg-surface"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <MediaImage
            media={shown}
            locale={locale}
            fallbackAlt={t(product.name, locale)}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            minWidth={600}
            priority={priority}
            className="absolute inset-0 h-full w-full"
            imageClassName="transition-opacity duration-300"
          />

          <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
            {soldOut ? <Badge tone="solid">{dictionary.product.soldOut}</Badge> : null}
            {!soldOut && discount > 0 ? <Badge tone="brass">-{discount} %</Badge> : null}
            {!soldOut && isNew ? <Badge tone="solid">{dictionary.product.new}</Badge> : null}
            {tagSlugs.has('edition-limitee') ? (
              <Badge tone="solid">{dictionary.product.limited}</Badge>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="mt-3 flex flex-col gap-1">
        {product.styleLabel ? <p className="eyebrow">{product.styleLabel}</p> : null}

        <Link href={`/${locale}/products/${product.slug}`}>
          <h3 className="text-sm font-medium text-ink transition-colors group-hover:text-brass">
            {t(product.name, locale)}
          </h3>
        </Link>

        <p className="flex items-baseline gap-2 text-sm">
          <span className={cn('tabular-nums', discount > 0 && 'text-brass')}>
            {format(price, { locale: `${locale}-DZ` })}
          </span>
          {compareAt && discount > 0 ? (
            <span className="text-xs text-muted line-through tabular-nums">
              {format(compareAt, { locale: `${locale}-DZ` })}
            </span>
          ) : null}
        </p>

        {swatches.length > 1 ? (
          <div className="mt-1 flex items-center gap-1.5" role="group" aria-label={dictionary.product.colour}>
            {swatches.slice(0, 5).map((value, index) => (
              <button
                key={value.id}
                type="button"
                aria-label={t(value.name, locale)}
                aria-pressed={index === activeIndex}
                onClick={() => setActiveIndex(index)}
                className={cn(
                  'h-4 w-4 rounded-full border transition-transform',
                  index === activeIndex ? 'border-brass scale-110' : 'border-line',
                )}
                style={{ backgroundColor: value.swatchHex ?? '#888' }}
              />
            ))}
            {swatches.length > 5 ? (
              <span className="text-xs text-muted">+{swatches.length - 5}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
