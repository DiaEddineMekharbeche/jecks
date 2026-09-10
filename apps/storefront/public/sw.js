/**
 * Service worker — PRD F-ST-54.
 *
 * Deliberately small and hand-written. A generated worker from a plugin would cache
 * far more aggressively than a shop wants: a stale price or a stale stock badge is
 * worse than a slow page, so HTML is never served from the cache while the network is
 * reachable.
 *
 * What it does cache is the two things that make a repeat visit feel instant on a
 * mobile connection in Algeria: the build's static assets, and product imagery.
 */

const VERSION = 'v1';
const STATIC_CACHE = `jk-static-${VERSION}`;
const IMAGE_CACHE = `jk-images-${VERSION}`;
const OFFLINE_URL = '/offline';

/** Images are the bulk of the bytes, so the cache is capped rather than unbounded. */
const MAX_IMAGES = 60;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      // A failed precache must not stop the worker installing; the offline page is a
      // nicety, and a worker that refuses to install helps nobody.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('jk-') && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch the API. A cached cart, a cached stock level or a cached order is a
  // wrong answer presented with total confidence.
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    if (isImage(request, url)) event.respondWith(cacheFirstImage(request));
    return;
  }

  // Next's fingerprinted build output can be cached forever: the name changes when the
  // content does.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isImage(request, url)) {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  // Documents go to the network, and fall back to the offline page only when the
  // network is genuinely unreachable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
  }
});

function isImage(request, url) {
  return (
    request.destination === 'image' ||
    /\.(?:avif|webp|png|jpe?g|gif|svg)$/i.test(url.pathname) ||
    url.pathname.includes('/media/')
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque cross-origin responses are stored too: a CDN image still counts.
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      await trim(cache, MAX_IMAGES);
    }
    return response;
  } catch (error) {
    // An image that cannot be fetched and was never cached simply fails; the page's
    // own placeholder takes over.
    return cached ?? Response.error();
  }
}

/** Oldest-first eviction. `keys()` returns insertion order, which is good enough. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
