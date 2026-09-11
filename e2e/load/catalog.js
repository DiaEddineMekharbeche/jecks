import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Catalogue read load — PRD Section 1.3 and M7.
 *
 * The target is 200 concurrent readers with a p95 under 200 ms. That number is only
 * reachable with the Redis cache in front of the catalogue; without it the same script
 * is a useful way to see how far the database alone gets, which is why the cache hit
 * rate is read from `/metrics` at the end rather than assumed.
 *
 * Run it against a seeded stack:
 *
 *   k6 run -e BASE=http://localhost:4000/api/v1 e2e/load/catalog.js
 *
 * The mix is deliberate. Real traffic is mostly grids and product pages, with a much
 * smaller tail of searches, and a load test made of one endpoint measures that endpoint
 * rather than the shop.
 */

const BASE = __ENV.BASE || 'http://localhost:4000/api/v1';
const INTERNAL_TOKEN = __ENV.INTERNAL_API_TOKEN || '';

const errors = new Rate('failed_requests');
const gridLatency = new Trend('grid_latency', true);
const productLatency = new Trend('product_latency', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Warm the cache before measuring: a cold start measures the database, and the
        // first shopper of the day is not the case this target is about.
        { duration: '30s', target: 50 },
        { duration: '1m', target: 200 },
        { duration: '2m', target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // The PRD's number, on the endpoints a shopper waits for.
    'grid_latency': ['p(95)<200'],
    'product_latency': ['p(95)<200'],
    'failed_requests': ['rate<0.01'],
    'http_req_duration{expected_response:true}': ['p(99)<1000'],
  },
};

/** Seeded collection slugs; a 404 here means the seed did not run. */
const COLLECTIONS = ['heritage', 'nouveautes', 'essentiels'];
const SEARCHES = ['casquette', 'snapback', 'cuir', 'bleu', 'heritage'];

export function setup() {
  // Fail early and loudly rather than reporting a beautiful p95 over 404s.
  const probe = http.get(`${BASE}/catalog/products?perPage=1`);
  if (probe.status !== 200) {
    throw new Error(`Catalogue is not answering (${probe.status}). Is the stack seeded?`);
  }

  const body = probe.json();
  const slug = body && body.data && body.data[0] ? body.data[0].slug : null;
  if (!slug) throw new Error('No products in the catalogue; run pnpm db:seed first.');

  return { slug };
}

export default function browse(data) {
  // A grid page, which is where most sessions start.
  const page = 1 + Math.floor(Math.random() * 3);
  const grid = http.get(`${BASE}/catalog/products?page=${page}&perPage=24`, {
    tags: { name: 'catalog_grid' },
  });

  gridLatency.add(grid.timings.duration);
  errors.add(grid.status !== 200);
  check(grid, { 'grid is 200': (r) => r.status === 200 });

  sleep(0.2);

  // Then a product, which is the page that decides a sale.
  const product = http.get(`${BASE}/catalog/products/${data.slug}`, {
    tags: { name: 'catalog_product' },
  });

  productLatency.add(product.timings.duration);
  errors.add(product.status !== 200);
  check(product, { 'product is 200': (r) => r.status === 200 });

  sleep(0.3);

  // A smaller tail: collections and search.
  if (Math.random() < 0.3) {
    const slug = COLLECTIONS[Math.floor(Math.random() * COLLECTIONS.length)];
    const collection = http.get(`${BASE}/catalog/collections/${slug}`, {
      tags: { name: 'catalog_collection' },
    });
    errors.add(collection.status >= 500);
  }

  if (Math.random() < 0.15) {
    const term = SEARCHES[Math.floor(Math.random() * SEARCHES.length)];
    const search = http.get(`${BASE}/catalog/search?q=${term}`, { tags: { name: 'catalog_search' } });
    errors.add(search.status !== 200);
  }

  sleep(0.5);
}

/**
 * Reads the cache hit rate back out of `/metrics`.
 *
 * A run that hits the latency target with a hit rate near zero is measuring a very fast
 * database rather than a working cache, and the difference matters the day the
 * catalogue grows.
 */
export function teardown() {
  if (!INTERNAL_TOKEN) {
    console.log('No INTERNAL_API_TOKEN set; skipping the cache hit-rate check.');
    return;
  }

  const metrics = http.get(`${BASE.replace(/\/api\/v1$/, '')}/api/v1/metrics`, {
    headers: { 'x-internal-token': INTERNAL_TOKEN },
  });

  if (metrics.status !== 200) {
    console.log(`Could not read /metrics (${metrics.status}).`);
    return;
  }

  const hits = Number((/jecks_cache_hits_total (\d+)/.exec(metrics.body) || [])[1] || 0);
  const misses = Number((/jecks_cache_misses_total (\d+)/.exec(metrics.body) || [])[1] || 0);
  const total = hits + misses;

  console.log(
    total === 0
      ? 'Cache was never consulted.'
      : `Cache hit rate: ${((hits / total) * 100).toFixed(1)} % (${hits} / ${total})`,
  );
}
