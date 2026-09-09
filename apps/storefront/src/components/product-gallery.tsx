'use client';

import { t, type Locale } from '@jecks/shared';
import { cn } from '@jecks/ui';
import Image from 'next/image';
import { useState } from 'react';
import { mediaUrl } from '@/lib/api';
import type { MediaRef } from '@/lib/types';

/**
 * Media gallery of PRD F-ST-30. Thumbnails on the side from `lg`, a snapping swipe
 * strip below it. The active image is driven from the parent so a colour choice on the
 * variant picker moves the gallery with it.
 */
export function ProductGallery({
  media,
  locale,
  title,
  activeIndex,
  onSelect,
}: {
  media: MediaRef[];
  locale: Locale;
  title: string;
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const active = media[activeIndex] ?? media[0];

  if (!active) {
    return <div className="aspect-[4/5] w-full rounded-sm bg-elevated" />;
  }

  return (
    <div className="flex flex-col-reverse gap-3 lg:flex-row">
      {media.length > 1 ? (
        <ul
          className="no-scrollbar flex gap-2 overflow-x-auto lg:w-20 lg:flex-col lg:overflow-visible"
          aria-label={title}
        >
          {media.map((item, index) => (
            <li key={item.storageKey} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={index === activeIndex ? 'true' : undefined}
                className={cn(
                  'relative aspect-square w-16 overflow-hidden rounded-sm border transition-colors lg:w-full',
                  index === activeIndex ? 'border-brass' : 'border-line hover:border-muted',
                )}
              >
                <Image
                  src={mediaUrl(item.storageKey) ?? ''}
                  alt={t(item.alt, locale) || `${title} ${index + 1}`}
                  fill
                  sizes="80px"
                  className="object-cover"
                  unoptimized={item.storageKey.endsWith('.svg')}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setZoomed((value) => !value)}
        className="relative aspect-[4/5] flex-1 overflow-hidden rounded-sm bg-surface"
        aria-label={zoomed ? 'Réduire' : 'Agrandir'}
      >
        <Image
          src={mediaUrl(active.storageKey) ?? ''}
          alt={t(active.alt, locale) || title}
          fill
          sizes="(max-width: 1024px) 100vw, 45vw"
          priority
          className={cn(
            'object-cover transition-transform duration-500 ease-brand',
            zoomed && 'scale-150',
          )}
          unoptimized={active.storageKey.endsWith('.svg')}
        />
      </button>
    </div>
  );
}
