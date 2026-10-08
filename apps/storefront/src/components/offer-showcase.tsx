'use client';

import { t, type Locale } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { useEffect, useRef, useState } from 'react';
import { MediaImage } from './media-image';
import { OfferOrderForm } from './offer-order-form';
import { ProductPurchase } from './product-purchase';
import type { Dictionary } from '@/lib/dictionary';
import type { ProductDetail } from '@/lib/types';

/**
 * The advert page for a shop with several products.
 *
 * One big picture that swipes left and right through the products, a row of small
 * pictures under it (one per product, tap to jump), and under that the chosen product's
 * options and the order form already open. Swiping and tapping a thumbnail both change
 * the chosen product, so what the shopper sees is always what the form will order.
 */
export function OfferShowcase({
  products,
  locale,
  dictionary,
}: {
  products: ProductDetail[];
  locale: Locale;
  dictionary: Dictionary;
}) {
  const [index, setIndex] = useState(0);
  const slides = useRef<Array<HTMLDivElement | null>>([]);
  const thumbs = useRef<Array<HTMLButtonElement | null>>([]);
  const track = useRef<HTMLDivElement | null>(null);

  // The slide that is mostly in view is the chosen one. An observer rather than
  // scrollLeft arithmetic, so it also holds in a right-to-left (Arabic) layout.
  useEffect(() => {
    const root = track.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const found = slides.current.indexOf(entry.target as HTMLDivElement);
            if (found >= 0) setIndex(found);
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const slide of slides.current) if (slide) observer.observe(slide);
    return () => observer.disconnect();
  }, [products.length]);

  // Keep the chosen thumbnail visible in its strip, without moving the page.
  useEffect(() => {
    thumbs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  function choose(next: number) {
    setIndex(next);
    slides.current[next]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }

  const product = products[index] ?? products[0];
  if (!product) return null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div
        ref={track}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-sm"
        aria-roledescription="carousel"
      >
        {products.map((item, position) => (
          <div
            key={item.id}
            ref={(element) => {
              slides.current[position] = element;
            }}
            className="relative aspect-[4/5] w-full shrink-0 snap-center bg-surface"
          >
            <MediaImage
              media={item.media[0]?.media}
              locale={locale}
              fallbackAlt={t(item.name, locale)}
              sizes="(max-width: 640px) 100vw, 36rem"
              minWidth={1000}
              priority={position === 0}
              className="absolute inset-0 h-full w-full"
            />
          </div>
        ))}
      </div>

      <ul className="no-scrollbar flex gap-2 overflow-x-auto" aria-label="Produits">
        {products.map((item, position) => (
          <li key={item.id} className="shrink-0">
            <button
              type="button"
              ref={(element) => {
                thumbs.current[position] = element;
              }}
              onClick={() => choose(position)}
              aria-current={position === index ? 'true' : undefined}
              aria-label={t(item.name, locale)}
              className={cn(
                'relative block aspect-square w-16 overflow-hidden rounded-sm border-2 transition-colors',
                position === index ? 'border-brass' : 'border-line opacity-70',
              )}
            >
              <MediaImage
                media={item.media[0]?.media}
                locale={locale}
                fallbackAlt={t(item.name, locale)}
                sizes="64px"
                minWidth={200}
                className="absolute inset-0 h-full w-full"
              />
            </button>
          </li>
        ))}
      </ul>

      {/* Keyed by product: a new choice starts a fresh form, with its own order key. */}
      <ProductPurchase
        key={product.id}
        product={product}
        locale={locale}
        dictionary={dictionary}
        heading="h1"
        hideGallery
        renderActions={(choice) => (
          <OfferOrderForm {...choice} startOpen locale={locale} dictionary={dictionary} />
        )}
      />
    </div>
  );
}
