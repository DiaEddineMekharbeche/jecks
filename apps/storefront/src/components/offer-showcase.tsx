'use client';

import { t, type Locale } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MediaImage } from './media-image';
import { OfferOrderForm } from './offer-order-form';
import { ProductPurchase } from './product-purchase';
import type { Dictionary } from '@/lib/dictionary';
import type { ProductDetail } from '@/lib/types';

/**
 * The shop on one screen, for a shop with several products.
 *
 * One big picture that swipes left and right through every picture of every product, in
 * product order; a row of small pictures under it (one per product, tap to jump to it);
 * and under that the chosen product's options and the order form already open. Whichever
 * product's picture is on screen is the product the form orders.
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
  // Every picture of every product, in one strip. A product with none keeps one empty
  // slide, so it can still be chosen.
  const slides = useMemo(
    () =>
      products.flatMap((product, productIndex) => {
        const pictures = product.media.map((entry) => entry.media);
        return (pictures.length > 0 ? pictures : [undefined]).map((media, position) => ({
          key: `${product.id}:${position}`,
          productIndex,
          position,
          count: Math.max(pictures.length, 1),
          media,
        }));
      }),
    [products],
  );

  const [slideIndex, setSlideIndex] = useState(0);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const thumbs = useRef<Array<HTMLButtonElement | null>>([]);
  const track = useRef<HTMLDivElement | null>(null);

  const current = slides[slideIndex] ?? slides[0];
  const index = current?.productIndex ?? 0;

  // The slide that is mostly in view is the chosen one. An observer rather than
  // scrollLeft arithmetic, so it also holds in a right-to-left (Arabic) layout.
  useEffect(() => {
    const root = track.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const found = slideRefs.current.indexOf(entry.target as HTMLDivElement);
            if (found >= 0) setSlideIndex(found);
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const slide of slideRefs.current) if (slide) observer.observe(slide);
    return () => observer.disconnect();
  }, [slides.length]);

  // Keep the chosen product's thumbnail visible in its strip, without moving the page.
  useEffect(() => {
    thumbs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  function chooseProduct(productIndex: number) {
    const first = slides.findIndex((slide) => slide.productIndex === productIndex);
    if (first < 0) return;
    setSlideIndex(first);
    slideRefs.current[first]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }

  const product = products[index] ?? products[0];
  if (!product || !current) return null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="relative">
        <div
          ref={track}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-sm"
          aria-roledescription="carousel"
        >
          {slides.map((slide, position) => (
            <div
              key={slide.key}
              ref={(element) => {
                slideRefs.current[position] = element;
              }}
              className="relative aspect-[4/5] w-full shrink-0 snap-center bg-surface"
            >
              <MediaImage
                media={slide.media}
                locale={locale}
                fallbackAlt={t(products[slide.productIndex]!.name, locale)}
                sizes="(max-width: 640px) 100vw, 36rem"
                minWidth={1000}
                priority={position === 0}
                className="absolute inset-0 h-full w-full"
              />
            </div>
          ))}
        </div>

        {current.count > 1 ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5"
            aria-hidden
          >
            {Array.from({ length: current.count }, (_, dot) => (
              <span
                key={dot}
                className={cn(
                  'h-1.5 w-1.5 rounded-full bg-white/50',
                  dot === current.position && 'w-4 bg-white',
                )}
              />
            ))}
          </div>
        ) : null}
      </div>

      <ul className="no-scrollbar flex gap-2 overflow-x-auto" aria-label="Produits">
        {products.map((item, position) => (
          <li key={item.id} className="shrink-0">
            <button
              type="button"
              ref={(element) => {
                thumbs.current[position] = element;
              }}
              onClick={() => chooseProduct(position)}
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
