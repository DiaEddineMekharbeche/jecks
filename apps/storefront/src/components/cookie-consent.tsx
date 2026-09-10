'use client';

import type { Locale } from '@jecks/shared';
import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useState } from 'react';
import { consent, setConsent, type ConsentState } from '@/lib/analytics';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Cookie consent, and the pixels it gates — PRD F-ST-53.
 *
 * The third-party scripts are not on the page until the shopper accepts. A banner that
 * appears above trackers already running is theatre; this one is the switch.
 *
 * The shop's own analytics are unaffected either way: they are first-party, carry no
 * identifier beyond a per-tab random string, and are what the owner's reports read.
 */
export function CookieConsent({
  dictionary,
  locale,
  pixels,
}: {
  dictionary: Dictionary;
  locale: Locale;
  pixels: { ga4?: string; meta?: string; tiktok?: string };
}) {
  const [state, setState] = useState<ConsentState>('unknown');
  const [mounted, setMounted] = useState(false);

  // Read on mount rather than during render: localStorage is not available on the
  // server, and reading it in render would make the markup differ between the two.
  useEffect(() => {
    setMounted(true);
    setState(consent());

    function onChange(event: Event) {
      setState((event as CustomEvent<ConsentState>).detail);
    }
    window.addEventListener('jk:consent', onChange);
    return () => window.removeEventListener('jk:consent', onChange);
  }, []);

  if (!mounted) return null;

  const granted = state === 'granted';

  return (
    <>
      {granted ? <Pixels pixels={pixels} /> : null}

      {state === 'unknown' ? (
        <div
          role="dialog"
          aria-label={dictionary.consent.title}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md"
        >
          <div className="shell flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              {dictionary.consent.body}{' '}
              <Link
                href={`/${locale}/pages/confidentialite`}
                className="underline underline-offset-2 hover:text-ink"
              >
                {dictionary.consent.learnMore}
              </Link>
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setConsent('denied');
                  setState('denied');
                }}
                className="border border-line px-4 py-2 text-xs uppercase tracking-wider text-muted transition-colors hover:text-ink"
              >
                {dictionary.consent.reject}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConsent('granted');
                  setState('granted');
                }}
                className="bg-brass px-4 py-2 text-xs font-semibold uppercase tracking-wider text-base transition-colors hover:bg-brass-soft"
              >
                {dictionary.consent.accept}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The third-party tags, mounted only once consent is granted.
 *
 * `afterInteractive` rather than `beforeInteractive`: a marketing pixel must never sit
 * on the critical path of a product page on a 3G connection in Sétif.
 */
function Pixels({ pixels }: { pixels: { ga4?: string; meta?: string; tiktok?: string } }) {
  return (
    <>
      {pixels.ga4 ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${pixels.ga4}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${pixels.ga4}',{anonymize_ip:true});`}
          </Script>
        </>
      ) : null}

      {pixels.meta ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixels.meta}');fbq('track','PageView');`}
        </Script>
      ) : null}

      {pixels.tiktok ? (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(e,n){e[n]=function(){e.push([n].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=n;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]={};var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=n+"?sdkid="+e;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${pixels.tiktok}');ttq.page()}(window,document,'ttq');`}
        </Script>
      ) : null}
    </>
  );
}
