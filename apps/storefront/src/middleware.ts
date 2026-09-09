import { LOCALES, DEFAULT_LOCALE, negotiateLocale } from '@jecks/shared';
import { NextResponse, type NextRequest } from 'next/server';

const LOCALE_COOKIE = 'jk_locale';

/**
 * Every page lives under a locale segment (`/fr/...`), which is what makes `hreflang`
 * and per-language canonical URLs work (PRD F-ST-05). A request without one is sent to
 * the visitor's language: their previous choice first, then `Accept-Language`.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  const stored = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale =
    stored && (LOCALES as readonly string[]).includes(stored)
      ? stored
      : negotiateLocale(request.headers.get('accept-language')) || DEFAULT_LOCALE;

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals, the API proxy and anything that looks like a file.
  matcher: ['/((?!_next|api|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};
