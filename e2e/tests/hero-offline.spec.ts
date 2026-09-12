import { expect, test } from '@playwright/test';
import { URLS } from '../fixtures/accounts.js';

/**
 * The 3D hero must not depend on anything outside this shop.
 *
 * `<Environment preset="studio" />` fetched an HDR map from a third-party CDN at
 * runtime, so the hero threw "Could not load studio_small_03_1k.hdr" whenever that host
 * was slow or unreachable — which, for a shop selling in Algeria, is a normal Tuesday.
 *
 * This asserts the page makes no request off its own origins at all. That covers the
 * HDR and everything anybody adds later without thinking about it.
 */
test('the home page loads without calling anything third-party', async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];

  // `localhost` and `127.0.0.1` are the same machine, and the two URLs are configured
  // independently, so the comparison is on the port rather than on the spelling.
  const isOwn = (url: string): boolean => {
    const { hostname, port } = new URL(url);
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
    const ownPorts = [URLS.storefront, URLS.api].map((entry) => new URL(entry).port);
    return loopback && ownPorts.includes(port);
  };

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (!isOwn(url)) external.push(url);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${URLS.storefront}/fr`, { waitUntil: 'networkidle' });

  // The hero only mounts when it scrolls into view, so it has to be brought there.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(4000);

  expect(external, `third-party requests:\n${external.join('\n')}`).toEqual([]);
  expect(
    errors.filter((text) => /hdr|Could not load|Failed to fetch/i.test(text)),
    `errors:\n${errors.join('\n')}`,
  ).toEqual([]);
});
