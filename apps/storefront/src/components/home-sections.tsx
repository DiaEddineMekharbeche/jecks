import { t, type Locale } from '@jecks/shared';
import { buttonVariants } from '@jecks/ui';
import { Quote, Star } from 'lucide-react';
import Link from 'next/link';
import { MediaImage } from './media-image';
import { NewsletterForm } from './newsletter-form';
import { apiGet } from '@/lib/api';
import type { Dictionary } from '@/lib/dictionary';
import type { HomeSection } from '@/lib/types';

/**
 * The home-builder section types that are not product rails — PRD F-AD-23.
 *
 * Each one reads its content from the section row the owner configured in the admin,
 * so a shop can rearrange its home page without a deploy. A section whose content is
 * missing renders nothing rather than an empty frame: a half-configured lookbook should
 * be invisible, not a hole in the page.
 */

interface LookbookConfig {
  images?: Array<{ mediaKey?: string; caption?: string; href?: string }>;
  columns?: number;
}

export function Lookbook({ section, locale }: { section: HomeSection; locale: Locale }) {
  const config = (section.config ?? {}) as LookbookConfig;
  const images = config.images ?? [];
  if (images.length === 0) return null;

  const columns = Math.min(Math.max(config.columns ?? 3, 2), 4);

  return (
    <section className="shell py-section">
      {section.title ? <h2 className="text-hero">{t(section.title, locale)}</h2> : null}
      {section.subtitle ? (
        <p className="mt-3 max-w-prose text-muted">{t(section.subtitle, locale)}</p>
      ) : null}

      <div
        className="mt-8 grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {images.map((image, index) => {
          const frame = (
            <figure className="card-lift group relative overflow-hidden rounded-sm">
              <MediaImage
                media={{ storageKey: image.mediaKey ?? '' }}
                locale={locale}
                fallbackAlt={image.caption ?? ''}
                sizes={`(max-width: 640px) 50vw, ${Math.round(100 / columns)}vw`}
                className="aspect-[3/4] w-full"
                imageClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              {image.caption ? (
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-sm">
                  {image.caption}
                </figcaption>
              ) : null}
            </figure>
          );

          return image.href ? (
            <Link key={index} href={`/${locale}${image.href}`}>
              {frame}
            </Link>
          ) : (
            <div key={index}>{frame}</div>
          );
        })}
      </div>
    </section>
  );
}

interface TestimonialConfig {
  /** Hand-picked quotes; when absent the section shows recent five-star reviews. */
  quotes?: Array<{ body: string; author: string; rating?: number }>;
  productId?: string;
  limit?: number;
}

/**
 * Testimonials, sourced from real approved reviews when the owner has not pinned
 * specific quotes. Invented testimonials are the one thing this section must not do.
 */
export async function Testimonials({
  section,
  locale,
}: {
  section: HomeSection;
  locale: Locale;
}) {
  const config = (section.config ?? {}) as TestimonialConfig;

  let quotes = config.quotes ?? [];

  if (quotes.length === 0) {
    // No pinned quotes: fall back to real approved reviews. A shop with none shows
    // nothing here rather than an invented testimonial.
    const reviews = config.productId
      ? await apiGet<{ reviews: Array<{ body: string; authorName: string; rating: number }> }>(
          `/reviews/product/${config.productId}`,
          {
            query: { pageSize: config.limit ?? 3, sort: 'helpful' },
            revalidate: 900,
            tags: ['reviews'],
          },
        )
          .then((summary) => summary.reviews)
          .catch(() => [])
      : await apiGet<Array<{ body: string; authorName: string; rating: number }>>(
          '/reviews/featured',
          { query: { limit: config.limit ?? 6 }, revalidate: 900, tags: ['reviews'] },
        ).catch(() => []);

    quotes = reviews
      .filter((review) => review.rating >= 4)
      .map((review) => ({ body: review.body, author: review.authorName, rating: review.rating }));
  }

  if (quotes.length === 0) return null;

  return (
    <section className="border-y border-line bg-surface">
      <div className="shell py-section">
        {section.title ? (
          <h2 className="text-hero text-center">{t(section.title, locale)}</h2>
        ) : null}

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {quotes.slice(0, 3).map((quote, index) => (
            <figure key={index} className="flex flex-col gap-3 rounded-sm border border-line p-6">
              <Quote className="h-5 w-5 text-brass" aria-hidden />
              {quote.rating ? (
                <div className="flex gap-0.5" role="img" aria-label={`${quote.rating} / 5`}>
                  {Array.from({ length: 5 }, (_, star) => (
                    <Star
                      key={star}
                      className={
                        star < (quote.rating ?? 0)
                          ? 'h-3.5 w-3.5 fill-brass text-brass'
                          : 'h-3.5 w-3.5 text-line'
                      }
                    />
                  ))}
                </div>
              ) : null}
              <blockquote className="text-sm text-muted">{quote.body}</blockquote>
              <figcaption className="mt-auto text-xs uppercase tracking-wider text-muted">
                {quote.author}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function NewsletterSection({
  section,
  locale,
  dictionary,
}: {
  section: HomeSection;
  locale: Locale;
  dictionary: Dictionary;
}) {
  return (
    <section className="shell py-section">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <h2 className="text-hero">
          {section.title ? t(section.title, locale) : dictionary.footer.newsletter}
        </h2>
        <p className="mt-3 text-muted">
          {section.subtitle ? t(section.subtitle, locale) : dictionary.footer.newsletterHint}
        </p>
        <NewsletterForm dictionary={dictionary} locale={locale} source="home" />
      </div>
    </section>
  );
}

interface BannerConfig {
  mediaKey?: string;

  align?: 'start' | 'center' | 'end';
}

/** A full-width image banner with an optional call to action. */
export function PromoBannerSection({
  section,
  locale,
}: {
  section: HomeSection;
  locale: Locale;
}) {
  const config = (section.config ?? {}) as BannerConfig;
  const align =
    config.align === 'start'
      ? 'items-start text-start'
      : config.align === 'end'
        ? 'items-end text-end'
        : 'items-center text-center';

  return (
    <section className="relative isolate overflow-hidden">
      {section.media || config.mediaKey ? (
        <MediaImage
          media={section.media ?? { storageKey: config.mediaKey ?? '' }}
          locale={locale}
          fallbackAlt=""
          sizes="100vw"
          className="absolute inset-0 -z-10 h-full w-full"
          imageClassName="h-full w-full object-cover"
        />
      ) : null}
      <div className="absolute inset-0 -z-10 bg-black/50" />

      <div className={`shell flex flex-col gap-4 py-24 ${align}`}>
        <h2 className="max-w-2xl text-hero">{t(section.title, locale)}</h2>
        {section.subtitle ? (
          <p className="max-w-prose text-muted">{t(section.subtitle, locale)}</p>
        ) : null}
        {section.ctaUrl ? (
          <Link
            href={`/${locale}${section.ctaUrl}`}
            className={buttonVariants({ size: 'lg', editorial: true })}
          >
            {t(section.ctaLabel, locale)}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
