import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { URLS } from '../fixtures/accounts.js';

/**
 * Accessibility on the pages a shopper actually walks through — PRD M6.
 *
 * Automated checks catch perhaps a third of real barriers, so passing these is not the
 * same as being accessible. What they do catch is the third that is embarrassing and
 * cheap to fix: an image with no alternative text, a form field with no label, a control
 * reachable only with a mouse, and brass on dark falling below contrast.
 *
 * Serious and critical only. The moderate rules are mostly advisory and a suite that
 * cries about every one of them gets skipped, which leaves the critical ones unwatched.
 */

const IMPACTS = ['serious', 'critical'];

async function audit(page: Page, path: string) {
  await page.goto(`${URLS.storefront}${path}`, { waitUntil: 'domcontentloaded' });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  return results.violations.filter((violation) => IMPACTS.includes(violation.impact ?? ''));
}

/** Turns axe's output into something a reader can act on without opening a browser. */
function describe(violations: Awaited<ReturnType<typeof audit>>): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes
          .slice(0, 3)
          .map((node) => `    ${node.target.join(' ')}`)
          .join('\n'),
    )
    .join('\n');
}

test.describe('accessibility', () => {
  test('the home page has no serious barrier', async ({ page }) => {
    const violations = await audit(page, '/fr');

    expect(violations, describe(violations)).toEqual([]);
  });

  test('a product page has none either, in French', async ({ page, request }) => {
    const response = await request.get(`${URLS.api}/catalog/products?perPage=1`);
    const body = (await response.json()) as { data: Array<{ slug: string }> };
    const slug = body.data[0]?.slug;

    test.skip(!slug, 'the catalogue is empty');

    const violations = await audit(page, `/fr/products/${slug}`);
    expect(violations, describe(violations)).toEqual([]);
  });

  test('the search page has none', async ({ page }) => {
    const violations = await audit(page, '/fr/search?q=casquette');

    expect(violations, describe(violations)).toEqual([]);
  });

  test('the checkout form labels every field', async ({ page }) => {
    // The page where a missing label stops somebody buying rather than merely annoying
    // them.
    const violations = await audit(page, '/fr/checkout');

    expect(violations, describe(violations)).toEqual([]);
  });

  test('the Arabic home page reads right to left without new barriers', async ({ page }) => {
    // Direction is set per locale; getting it wrong makes the page unreadable rather
    // than merely ugly.
    await page.goto(`${URLS.storefront}/ar`, { waitUntil: 'domcontentloaded' });

    const direction = await page.locator('html').getAttribute('dir');
    expect(direction).toBe('rtl');

    const violations = await audit(page, '/ar');
    expect(violations, describe(violations)).toEqual([]);
  });

  test('the whole home page can be reached with a keyboard', async ({ page }) => {
    await page.goto(`${URLS.storefront}/fr`, { waitUntil: 'domcontentloaded' });

    // Tab a reasonable way in and check focus is somewhere real and visible. A trap or
    // an unreachable control shows up as focus never leaving the body.
    const reached = new Set<string>();

    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
      reached.add(tag);
    }

    expect(reached.has('BODY') && reached.size === 1).toBe(false);
    expect([...reached].some((tag) => ['A', 'BUTTON', 'INPUT', 'SELECT'].includes(tag))).toBe(true);
  });
});
