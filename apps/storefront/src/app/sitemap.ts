import { LOCALES } from '@jecks/shared';
import type { MetadataRoute } from 'next';
import { apiGet } from '@/lib/api';

/**
 * sitemap.xml (PRD F-ST-05). Every URL is listed once per locale with the sibling
 * languages as alternates, which is what tells Google the pages are translations of
 * one another rather than duplicates.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

interface SitemapPayload {
  products: Array<{ slug: string; updatedAt: string }>;
  collections: Array<{ slug: string; updatedAt: string }>;
  categories: Array<{ slug: string; updatedAt: string }>;
  pages: Array<{ slug: string; updatedAt: string }>;
}

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await apiGet<SitemapPayload>('/storefront/sitemap', {
    revalidate: 3600,
    tags: ['sitemap'],
  }).catch(() => ({ products: [], collections: [], categories: [], pages: [] }));

  const entries: MetadataRoute.Sitemap = [];

  const push = (path: string, lastModified: string | Date, priority: number, frequency: 'daily' | 'weekly' | 'monthly') => {
    for (const locale of LOCALES) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        lastModified: new Date(lastModified),
        changeFrequency: frequency,
        priority,
        alternates: {
          languages: Object.fromEntries(
            LOCALES.map((code) => [code, `${SITE_URL}/${code}${path}`]),
          ),
        },
      });
    }
  };

  push('', new Date(), 1, 'daily');

  for (const collection of data.collections) {
    push(`/collections/${collection.slug}`, collection.updatedAt, 0.8, 'daily');
  }
  for (const category of data.categories) {
    push(`/collections/${category.slug}`, category.updatedAt, 0.7, 'weekly');
  }
  for (const product of data.products) {
    push(`/products/${product.slug}`, product.updatedAt, 0.9, 'weekly');
  }
  for (const page of data.pages) {
    push(`/pages/${page.slug}`, page.updatedAt, 0.4, 'monthly');
  }

  return entries;
}
