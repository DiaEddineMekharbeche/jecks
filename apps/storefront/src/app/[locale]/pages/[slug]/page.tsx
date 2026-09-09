import { t, type Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import type { CmsPage } from '@/lib/types';

/** CMS pages of PRD F-ST-60. Content is authored in the admin, never in this repo. */
export const revalidate = 600;

async function loadPage(slug: string): Promise<CmsPage | null> {
  return apiGet<CmsPage>(`/storefront/pages/${slug}`, {
    revalidate: 600,
    tags: ['pages', `page:${slug}`],
  }).catch(() => null);
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const page = await loadPage(params.slug);
  if (!page) return {};
  const locale = params.locale as Locale;
  return {
    title: t(page.title, locale),
    alternates: { canonical: `/${locale}/pages/${page.slug}` },
  };
}

export default async function ContentPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const locale = params.locale as Locale;
  const page = await loadPage(params.slug);
  if (!page) notFound();

  return (
    <article className="shell py-section">
      <h1 className="max-w-4xl text-hero">{t(page.title, locale)}</h1>
      <div
        className="mt-8 max-w-prose space-y-4 text-muted [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:text-ink [&_table]:w-full [&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_th]:border-b [&_th]:border-line [&_th]:py-2 [&_th]:text-start"
        // Authored by staff through the admin rich-text editor.
        dangerouslySetInnerHTML={{ __html: t(page.body, locale) }}
      />
    </article>
  );
}
