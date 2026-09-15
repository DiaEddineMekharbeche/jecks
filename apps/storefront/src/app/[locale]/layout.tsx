import { LOCALES, dir, type Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { Bebas_Neue, Cairo, Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { StorefrontProviders } from '@/components/storefront-providers';
import { apiGet } from '@/lib/api';
import { getDictionary, isSupportedLocale } from '@/lib/dictionary';
import type { Bootstrap } from '@/lib/types';
import '@/styles/globals.css';

// Self-hosted through next/font: no render-blocking request to Google, and the
// fallback metrics are matched so the headline does not reflow (PRD Section 10.7).
const display = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});
const arabic = Cairo({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * Deliberately empty. Listing the locales here pre-rendered every page at image build
 * time, when there is no API to read from, so pages were baked with empty rails and
 * default branding and served that way to the first visitors and crawlers after each
 * deploy. The failed fetches left no cache tags either, so an admin publish could not
 * clear them early.
 *
 * An empty list is not the same as no function: Next still treats the route as
 * cacheable, renders each locale on its first real request and caches it from there on
 * the `revalidate` of each page. Without the function at all, every request re-renders.
 * Unknown locales still 404 below.
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const titles: Record<string, { title: string; description: string }> = {
    fr: {
      title: "Jeck's — Casquettes et chapeaux",
      description:
        'Casquettes dessinées à Alger, séries courtes, paiement à la livraison dans les 58 wilayas.',
    },
    ar: {
      title: 'جيكس — قبعات',
      description: 'قبعات مصممة في الجزائر العاصمة، سلاسل قصيرة، الدفع عند الاستلام في 58 ولاية.',
    },
    en: {
      title: "Jeck's — Caps and hats",
      description: 'Caps drawn in Algiers, short runs, cash on delivery across all 58 wilayas.',
    },
  };
  const copy = titles[locale] ?? titles.fr!;

  // The shop's own favicon when one is picked in Settings › Thème. Fetched here rather
  // than hardcoded so changing it is a setting, not a deploy; a failure falls through to
  // the static icon in /public.
  const bootstrap = await apiGet<Bootstrap>('/storefront/bootstrap', {
    revalidate: 300,
    tags: ['bootstrap'],
  }).catch(() => null);

  const faviconUrl = bootstrap?.theme?.faviconUrl ?? null;

  return {
    metadataBase: new URL(SITE_URL),
    ...(faviconUrl ? { icons: { icon: faviconUrl, apple: faviconUrl } } : {}),
    title: { default: copy.title, template: `%s — Jeck's` },
    description: copy.description,
    // hreflang for every language, so Google serves the right one (PRD F-ST-05).
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALES.map((code) => [code, `/${code}`])),
    },
    openGraph: {
      type: 'website',
      siteName: "Jeck's",
      title: copy.title,
      description: copy.description,
      locale,
      url: `/${locale}`,
    },
    twitter: { card: 'summary_large_image', title: copy.title, description: copy.description },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  if (!isSupportedLocale(params.locale)) notFound();
  const locale = params.locale;
  const dictionary = getDictionary(locale);

  // One request feeds the header, the announcement bar and the footer.
  const bootstrap = await apiGet<Bootstrap>('/storefront/bootstrap', {
    revalidate: 300,
    tags: ['bootstrap'],
  }).catch(() => null);

  const header = bootstrap?.menus.find((menu) => menu.slug === 'header');
  const footer = bootstrap?.menus.find((menu) => menu.slug === 'footer');

  return (
    <html
      lang={locale}
      dir={dir(locale)}
      className={`${display.variable} ${body.variable} ${arabic.variable}`}
      // Bridges next/font variables onto the design tokens, so the token file stays
      // the single place fonts are named.
      style={
        {
          ['--jk-font-display']: 'var(--font-display)',
          ['--jk-font-body']: 'var(--font-body)',
          ['--jk-font-arabic']: 'var(--font-arabic)',
        } as CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-base text-ink antialiased">
        <a href="#main" className="skip-link">
          {dictionary.nav.skipToContent}
        </a>

        <Header
          locale={locale}
          dictionary={dictionary}
          items={header?.items ?? []}
          announcements={bootstrap?.announcements ?? []}
          logoUrl={bootstrap?.theme?.logoUrl ?? null}
          storeName={
            typeof bootstrap?.settings?.['store.name'] === 'string'
              ? (bootstrap.settings['store.name'] as string)
              : undefined
          }
        />

        <main id="main">{children}</main>

        <Footer
          locale={locale}
          dictionary={dictionary}
          items={footer?.items ?? []}
          storeName={String(bootstrap?.settings['store.name'] ?? "Jeck's")}
        />

        <StorefrontProviders
          locale={locale}
          dictionary={dictionary}
          pixels={{
            ga4: String(bootstrap?.settings['integrations.ga4_id'] ?? '') || undefined,
            meta: String(bootstrap?.settings['integrations.meta_pixel_id'] ?? '') || undefined,
            tiktok: String(bootstrap?.settings['integrations.tiktok_pixel_id'] ?? '') || undefined,
            banner: bootstrap?.settings['integrations.cookie_banner'] !== false,
          }}
        />

        <OrganizationJsonLd locale={locale} />
      </body>
    </html>
  );
}

/** Organization JSON-LD, required by PRD F-ST-05. */
function OrganizationJsonLd({ locale }: { locale: Locale }) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: "Jeck's",
    url: `${SITE_URL}/${locale}`,
    logo: `${SITE_URL}/logo.svg`,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'DZ',
      addressLocality: 'Alger',
    },
    sameAs: ['https://instagram.com/jecks.dz', 'https://facebook.com/jecks.dz'],
  };
  return (
    <script
      type="application/ld+json"
      // Serialized server-side from values we control; no user input reaches it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
