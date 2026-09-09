'use client';

import { discountPercent, format, money, t, type Locale } from '@jecks/shared';
import { Badge, Button, cn } from '@jecks/ui';
import { Heart, Share2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DeliveryEstimator } from './delivery-estimator';
import { ProductGallery } from './product-gallery';
import type { Dictionary } from '@/lib/dictionary';
import { fill } from '@/lib/dictionary';
import type { ProductDetail } from '@/lib/types';

/**
 * The interactive half of the product page: gallery, option selection, stock state and
 * the delivery estimator (PRD F-ST-30 to F-ST-34).
 *
 * Option choices resolve to exactly one variant. A combination that does not exist is
 * shown disabled rather than hidden, so the shopper can see the colour exists but the
 * size does not.
 */
export function ProductPurchase({
  product,
  locale,
  dictionary,
}: {
  product: ProductDetail;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const media = product.media.map((entry) => entry.media);

  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    // Preselect the first in-stock variant so the page opens on something buyable.
    const first = product.variants.find((variant) => variant.inStock) ?? product.variants[0];
    if (!first) return {};
    const out: Record<string, string> = {};
    for (const option of product.options) {
      const match = option.values.find((value) =>
        first.optionValues.some((link) => link.optionValueId === value.id),
      );
      if (match) out[option.id] = match.id;
    }
    return out;
  });

  const [galleryIndex, setGalleryIndex] = useState(0);

  const selectedVariant = useMemo(() => {
    const wanted = Object.values(chosen);
    if (wanted.length !== product.options.length) return null;
    return (
      product.variants.find((variant) =>
        wanted.every((valueId) =>
          variant.optionValues.some((link) => link.optionValueId === valueId),
        ),
      ) ?? null
    );
  }, [chosen, product.options.length, product.variants]);

  /** A value is reachable if some variant carries it alongside the other choices. */
  const isReachable = (optionId: string, valueId: string): boolean => {
    const others = Object.entries(chosen).filter(([key]) => key !== optionId);
    return product.variants.some(
      (variant) =>
        variant.optionValues.some((link) => link.optionValueId === valueId) &&
        others.every(([, otherValueId]) =>
          variant.optionValues.some((link) => link.optionValueId === otherValueId),
        ),
    );
  };

  const price = money(BigInt(selectedVariant?.price ?? product.minPrice));
  const compareAt = selectedVariant?.compareAtPrice
    ? money(BigInt(selectedVariant.compareAtPrice))
    : product.maxCompareAt
      ? money(BigInt(product.maxCompareAt))
      : null;
  const discount = compareAt ? discountPercent(compareAt, price) : 0;

  const available = selectedVariant?.available ?? 0;
  const inStock = selectedVariant?.inStock ?? false;

  function chooseValue(optionId: string, valueId: string) {
    setChosen((previous) => ({ ...previous, [optionId]: valueId }));
    // Colour swatches move the gallery to that colourway.
    const option = product.options.find((item) => item.id === optionId);
    if (option?.kind === 'color') {
      const index = option.values.findIndex((value) => value.id === valueId);
      if (index >= 0 && index < media.length) setGalleryIndex(index);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16">
      <ProductGallery
        media={media}
        locale={locale}
        title={t(product.name, locale)}
        activeIndex={galleryIndex}
        onSelect={setGalleryIndex}
      />

      <div className="flex flex-col gap-6">
        <div>
          {product.styleLabel ? <p className="eyebrow">{product.styleLabel}</p> : null}
          <h1 className="mt-2 text-hero">{t(product.name, locale)}</h1>

          <div className="mt-4 flex items-center gap-3">
            <span className={cn('text-2xl tabular-nums', discount > 0 && 'text-brass')}>
              {format(price, { locale: `${locale}-DZ` })}
            </span>
            {compareAt && discount > 0 ? (
              <>
                <span className="text-muted line-through tabular-nums">
                  {format(compareAt, { locale: `${locale}-DZ` })}
                </span>
                <Badge tone="brass">-{discount} %</Badge>
              </>
            ) : null}
          </div>

          {product.shortDescription ? (
            <p className="mt-4 text-sm text-muted">{t(product.shortDescription, locale)}</p>
          ) : null}
        </div>

        {product.options.map((option) => (
          <fieldset key={option.id}>
            <legend className="eyebrow mb-2">{t(option.name, locale)}</legend>
            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const active = chosen[option.id] === value.id;
                const reachable = isReachable(option.id, value.id);

                if (option.kind === 'color') {
                  return (
                    <button
                      key={value.id}
                      type="button"
                      title={t(value.name, locale)}
                      aria-label={t(value.name, locale)}
                      aria-pressed={active}
                      disabled={!reachable}
                      onClick={() => chooseValue(option.id, value.id)}
                      className={cn(
                        'h-9 w-9 rounded-full border-2 transition-transform',
                        active ? 'border-brass scale-110' : 'border-line',
                        !reachable && 'cursor-not-allowed opacity-30',
                      )}
                      style={{ backgroundColor: value.swatchHex ?? '#888' }}
                    />
                  );
                }

                return (
                  <button
                    key={value.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!reachable}
                    onClick={() => chooseValue(option.id, value.id)}
                    className={cn(
                      'min-w-14 rounded-sm border px-3 py-2 text-sm transition-colors',
                      active
                        ? 'border-brass bg-brass/10 text-brass'
                        : 'border-line text-muted hover:border-muted hover:text-ink',
                      !reachable && 'cursor-not-allowed border-dashed opacity-40 line-through',
                    )}
                  >
                    {t(value.name, locale)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="flex items-center gap-3 text-sm">
          {inStock ? (
            available <= 5 ? (
              <span className="text-warning">
                {fill(dictionary.product.onlyLeft, { count: available })}
              </span>
            ) : (
              <span className="text-success">{dictionary.product.inStock}</span>
            )
          ) : (
            <span className="text-danger">{dictionary.product.outOfStock}</span>
          )}
          {selectedVariant ? (
            <span className="text-muted">
              {dictionary.product.sku} {selectedVariant.sku}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {/* Cart and checkout arrive in M3; the button states are already correct. */}
          <Button size="lg" editorial disabled={!inStock} title={inStock ? undefined : dictionary.product.outOfStock}>
            {inStock ? dictionary.product.addToCart : dictionary.product.notifyMe}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="md" className="flex-1">
              <Heart className="h-4 w-4" />
              {dictionary.nav.wishlist}
            </Button>
            <Button variant="outline" size="icon" aria-label="Partager">
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DeliveryEstimator
          dictionary={dictionary}
          locale={locale}
          weightGrams={selectedVariant?.weightGrams ?? 180}
          subtotal={price.amount.toString()}
        />
      </div>
    </div>
  );
}
