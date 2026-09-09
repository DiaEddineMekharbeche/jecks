import { t, type Locale } from '@jecks/shared';
import { buttonVariants } from '@jecks/ui';
import Link from 'next/link';
import { Suspense } from 'react';
import { Countdown } from '@/components/countdown';
import { HeroSection } from '@/components/hero-section';
import { ProductRail } from '@/components/product-rail';
import { apiGet } from '@/lib/api';
import { getDictionary } from '@/lib/dictionary';
import type { CollectionSummary, HomeSection, ProductCard } from '@/lib/types';

/** The home builder of PRD F-AD-23 drives this page; sections come from the database. */
export const revalidate = 300;

export default async function HomePage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);

  const sections = await apiGet<HomeSection[]>('/storefront/home', {
    revalidate: 300,
    tags: ['home'],
  }).catch(() => [] as HomeSection[]);

  return (
    <>
      {sections.map((section, index) => (
        <Section
          key={section.id}
          section={section}
          locale={locale}
          dictionary={dictionary}
          first={index === 0}
        />
      ))}
    </>
  );
}

type SectionProps = {
  section: HomeSection;
  locale: Locale;
  dictionary: ReturnType<typeof getDictionary>;
  first: boolean;
};

function Section({ section, locale, dictionary, first }: SectionProps) {
  switch (section.kind) {
    case 'hero_3d':
      return <HeroSection section={section} locale={locale} />;

    case 'featured_collections':
      return (
        <Suspense fallback={<RailSkeleton />}>
            <FeaturedCollections section={section} locale={locale} />
        </Suspense>
      );

    case 'new_arrivals':
    case 'best_sellers':
      return (
        <Suspense fallback={<RailSkeleton />}>
            <ProductSection
            section={section}
            locale={locale}
            dictionary={dictionary}
            priority={first}
          />
        </Suspense>
      );

    case 'promo_countdown':
      return <PromoBanner section={section} locale={locale} />;

    case 'brand_story':
      return <BrandStory section={section} locale={locale} />;

    case 'testimonials':
    case 'newsletter':
      // Reviews land with M6; the newsletter lives in the footer already.
      return null;

    default:
      return null;
  }
}

async function ProductSection({
  section,
  locale,
  dictionary,
  priority,
}: {
  section: HomeSection;
  locale: Locale;
  dictionary: ReturnType<typeof getDictionary>;
  priority: boolean;
}) {
  const config = (section.config ?? {}) as { limit?: number; layout?: string };
  const slug = section.collection?.slug;

  const products = await apiGet<ProductCard[]>('/catalog/products', {
    query: {
      collection: slug,
      perPage: config.limit ?? 8,
      sort: section.kind === 'best_sellers' ? 'best_selling' : 'newest',
    },
    revalidate: 300,
    tags: ['products'],
  }).catch(() => [] as ProductCard[]);

  if (products.length === 0) return null;

  return (
    <ProductRail
      title={t(section.title, locale)}
      href={slug ? `/${locale}/collections/${slug}` : undefined}
      products={products}
      locale={locale}
      dictionary={dictionary}
      layout={config.layout === 'grid' ? 'grid' : 'carousel'}
      priority={priority}
    />
  );
}

async function FeaturedCollections({ section, locale }: { section: HomeSection; locale: Locale }) {
  const config = (section.config ?? {}) as { slugs?: string[] };
  const all = await apiGet<CollectionSummary[]>('/catalog/collections', {
    revalidate: 600,
    tags: ['collections'],
  }).catch(() => [] as CollectionSummary[]);

  const wanted = config.slugs ?? [];
  const collections = wanted.length
    ? wanted.map((slug) => all.find((item) => item.slug === slug)).filter(Boolean as never)
    : all.slice(0, 4);

  if (collections.length === 0) return null;

  return (
    <section className="shell py-section">
      <h2 className="text-hero">{t(section.title, locale)}</h2>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(collections as CollectionSummary[]).map((collection) => (
          <Link
            key={collection.slug}
            href={`/${locale}/collections/${collection.slug}`}
            className="card-lift group flex aspect-[4/3] flex-col justify-end rounded-sm border border-line bg-surface p-5"
          >
            <p className="font-display text-2xl transition-colors group-hover:text-brass">
              {t(collection.name, locale)}
            </p>
            {collection.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted">
                {t(collection.description, locale)}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

function PromoBanner({ section, locale }: { section: HomeSection; locale: Locale }) {
  const config = (section.config ?? {}) as { endsAt?: string };
  return (
    <section className="border-y border-line bg-surface">
      <div className="shell flex flex-col items-center gap-5 py-12 text-center">
        <h2 className="max-w-3xl text-hero text-brass">{t(section.title, locale)}</h2>
        {config.endsAt ? <Countdown endsAt={config.endsAt} /> : null}
        {section.ctaUrl ? (
          <Link
            href={`/${locale}${section.ctaUrl}`}
            className={buttonVariants({ size: 'lg', editorial: true, class: 'mt-2' })}
          >
            {t(section.ctaLabel, locale)}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function BrandStory({ section, locale }: { section: HomeSection; locale: Locale }) {
  return (
    <section className="shell grid gap-8 py-section lg:grid-cols-2 lg:items-center">
      <div>
        <h2 className="text-hero">{t(section.title, locale)}</h2>
        <p className="mt-4 max-w-prose text-muted">{t(section.subtitle, locale)}</p>
        {section.ctaUrl ? (
          <Link
            href={`/${locale}${section.ctaUrl}`}
            className="mt-6 inline-block border-b border-brass pb-1 text-sm uppercase tracking-widest text-brass"
          >
            {t(section.ctaLabel, locale)}
          </Link>
        ) : null}
      </div>
      <div className="aspect-[4/3] rounded-sm bg-gradient-to-br from-elevated to-surface" />
    </section>
  );
}

function RailSkeleton() {
  return (
    <div className="shell py-section">
      <div className="jk-skeleton h-8 w-64 rounded-sm" />
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="jk-skeleton aspect-[4/5] rounded-sm" />
        ))}
      </div>
    </div>
  );
}
