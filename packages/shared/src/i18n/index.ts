/**
 * Translated fields — PRD Section 6.4. Translatable DB columns are JSONB shaped
 * `{ "fr": "...", "ar": "...", "en": "..." }`. Reads always go through `t()` so a
 * missing translation degrades to the fallback chain instead of rendering blank.
 */

import { DEFAULT_LOCALE, LOCALES, Locale, RTL_LOCALES } from '../enums/index.js';

export type Translated = Partial<Record<Locale, string>>;

/** fr is the source of truth; en is the closest bridge; ar is last. */
export const FALLBACK_CHAIN: Record<Locale, readonly Locale[]> = {
  fr: ['fr', 'en', 'ar'],
  en: ['en', 'fr', 'ar'],
  ar: ['ar', 'fr', 'en'],
};

export function t(field: Translated | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!field) return '';
  for (const candidate of FALLBACK_CHAIN[locale] ?? FALLBACK_CHAIN[DEFAULT_LOCALE]) {
    const value = field[candidate];
    if (value != null && value.trim() !== '') return value;
  }
  return '';
}

/** True when every locale has a non-empty value — drives the admin completeness badge. */
export function isFullyTranslated(field: Translated | null | undefined): boolean {
  if (!field) return false;
  return LOCALES.every((locale) => (field[locale] ?? '').trim() !== '');
}

export function missingLocales(field: Translated | null | undefined): Locale[] {
  return LOCALES.filter((locale) => (field?.[locale] ?? '').trim() === '');
}

/** Shorthand for seeds and tests: `translated('Casquette', 'قبعة', 'Cap')`. */
export function translated(fr: string, ar?: string, en?: string): Translated {
  const out: Translated = { fr };
  if (ar) out.ar = ar;
  if (en) out.en = en;
  return out;
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function dir(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Pick the best supported locale from an `Accept-Language` header. */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', q = 'q=1'] = part.trim().split(';');
      return { tag: (tag.split('-')[0] ?? '').toLowerCase(), q: Number(q.replace('q=', '')) || 0 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

/**
 * Slugs are ASCII-only and generated from the French value so URLs stay stable
 * when Arabic copy is added later (PRD F-ST-05 canonical URLs).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}
