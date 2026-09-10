'use client';

import type { Locale } from '@jecks/shared';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { CartDrawer } from './cart-drawer';
import { CookieConsent } from './cookie-consent';
import { ServiceWorkerRegistration } from './service-worker';
import { useCart } from '@/lib/cart-store';
import { track } from '@/lib/analytics';
import type { Dictionary } from '@/lib/dictionary';

/**
 * The client shell every page sits inside: the cart drawer, the consent banner, and
 * the page-view tracking that feeds the funnel report.
 *
 * One component rather than three providers because none of them holds context — the
 * cart is a Zustand store any component can reach without a provider tree, which keeps
 * the server-rendered pages free of a client boundary they do not need.
 */
export function StorefrontProviders({
  locale,
  dictionary,
  pixels,
}: {
  locale: Locale;
  dictionary: Dictionary;
  pixels: { ga4?: string; meta?: string; tiktok?: string; banner: boolean };
}) {
  const load = useCart((state) => state.load);
  const pathname = usePathname();

  // The cart is fetched once on mount. Every mutation afterwards returns the whole
  // cart, so there is never a second reason to poll it.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    track({ name: 'page_view', path: pathname });
  }, [pathname]);

  return (
    <>
      <CartDrawer locale={locale} dictionary={dictionary} />
      <ServiceWorkerRegistration />
      {pixels.banner ? <CookieConsent dictionary={dictionary} locale={locale} pixels={pixels} /> : null}
    </>
  );
}
