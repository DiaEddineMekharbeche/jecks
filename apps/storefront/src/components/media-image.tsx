import { buildSrcSet, pickRendition, t, type Locale, type Rendition } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { mediaUrl } from '@/lib/api';
import type { MediaRef } from '@/lib/types';

/**
 * Renders a product image from its generated renditions — PRD Section 6.3.
 *
 * A plain `<picture>` rather than `next/image`: the sizes were already produced by the
 * worker, so routing them back through Next's optimizer would re-encode work that is
 * already done and add a hop for every request. AVIF is offered first, WebP second, and
 * the original last for anything that was never processed.
 *
 * The dominant colour is painted behind the image so a card shows roughly the right
 * colour while it loads instead of a grey rectangle.
 */
export function MediaImage({
  media,
  locale,
  fallbackAlt,
  sizes,
  minWidth = 600,
  priority = false,
  className,
  imageClassName,
}: {
  media: MediaRef | null | undefined;
  locale: Locale;
  fallbackAlt: string;
  /** The `sizes` attribute; without it a browser assumes the full viewport width. */
  sizes: string;
  /** Width used to pick the `src` fallback for browsers ignoring srcset. */
  minWidth?: number;
  priority?: boolean;
  className?: string;
  imageClassName?: string;
}) {
  if (!media) {
    return <div className={cn('bg-elevated', className)} aria-hidden />;
  }

  const renditions = (media.renditions ?? []) as Rendition[];
  const alt = t(media.alt, locale) || fallbackAlt;

  const chosen = pickRendition(renditions, minWidth, 'webp');
  const src = mediaUrl(chosen?.key ?? media.storageKey) ?? '';

  const avif = buildSrcSet(renditions, (key) => mediaUrl(key) ?? '', 'avif');
  const webp = buildSrcSet(renditions, (key) => mediaUrl(key) ?? '', 'webp');

  return (
    <picture
      className={cn('block', className)}
      style={media.blurhash ? { backgroundColor: media.blurhash } : undefined}
    >
      {avif ? <source type="image/avif" srcSet={avif} sizes={sizes} /> : null}
      {webp ? <source type="image/webp" srcSet={webp} sizes={sizes} /> : null}
      <img
        src={src}
        alt={alt}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        // The hero and the first row of a grid are the LCP candidates; everything else
        // waits until it is near the viewport.
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding={priority ? 'sync' : 'async'}
        className={cn('h-full w-full object-cover', imageClassName)}
      />
    </picture>
  );
}
