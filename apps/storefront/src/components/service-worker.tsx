'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker — PRD F-ST-54.
 *
 * Registration waits for `load` so it never competes with the first paint, and it is
 * skipped in development, where a cached build is a debugging trap rather than a
 * feature.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A refused registration (private mode, unsupported browser) is not an error
        // the shopper can act on; the site works exactly as before without it.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
