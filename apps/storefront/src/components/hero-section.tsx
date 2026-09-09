import { t, type Locale } from '@jecks/shared';
import { buttonVariants } from '@jecks/ui';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { HomeSection } from '@/lib/types';

// Three.js is ~150 kB gzipped; it never reaches the server bundle and only downloads
// once the hero scrolls into view (PRD Section 10.7).
const Hero3D = dynamic(() => import('./hero-3d').then((module) => module.Hero3D), {
  ssr: false,
  loading: () => <HeroPoster />,
});

/** Full-bleed hero with the 3D cap — PRD F-ST-10. */
export function HeroSection({ section, locale }: { section: HomeSection; locale: Locale }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <Hero3D className="absolute inset-0" />
      </div>

      {/* Keeps the headline readable over whatever the canvas renders. */}
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-r from-base via-base/85 to-transparent"
        aria-hidden
      />

      <div className="shell flex min-h-[68vh] max-w-shell flex-col justify-center py-section">
        <p className="eyebrow">Alger · 58 wilayas · {new Date().getFullYear()}</p>
        <h1 className="mt-4 max-w-4xl text-display">{t(section.title, locale)}</h1>
        <p className="mt-6 max-w-prose text-base text-muted sm:text-lg">
          {t(section.subtitle, locale)}
        </p>

        {section.ctaUrl ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={`/${locale}${section.ctaUrl}`}
              className={buttonVariants({ size: 'lg', editorial: true })}
            >
              {t(section.ctaLabel, locale)}
            </Link>
            <Link
              href={`/${locale}/collections`}
              className={buttonVariants({ variant: 'outline', size: 'lg', editorial: true })}
            >
              Collections
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Static stand-in that holds the layout while the canvas loads. */
function HeroPoster() {
  return (
    <div className="absolute inset-0" aria-hidden>
      <div className="absolute end-[12%] top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-brass/10 blur-3xl" />
    </div>
  );
}
