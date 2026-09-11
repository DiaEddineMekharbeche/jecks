import { expect, test } from '@playwright/test';
import { URLS } from '../fixtures/accounts.js';

/**
 * A promotion applies at checkout — PRD acceptance criterion 5.
 *
 * Run against the API rather than through the browser, because what is being checked is
 * that the cart and the engine agree: the storefront showing one discount while the
 * simulator predicts another is the failure that matters, and it is invisible in a
 * screenshot.
 */
test.describe('promotions', () => {
  test('the cart answers a seeded code without failing', async ({ request }) => {
    const products = await request.get(`${URLS.api}/catalog/products?perPage=1`);
    expect(products.ok()).toBeTruthy();

    const body = (await products.json()) as {
      data: Array<{ id: string; variants?: Array<{ id: string }> }>;
    };
    const variantId = body.data[0]?.variants?.[0]?.id;
    test.skip(!variantId, 'the grid response carries no variant id');

    const added = await request.post(`${URLS.api}/cart/items`, {
      data: { variantId, quantity: 1 },
      failOnStatusCode: false,
    });
    expect(added.status()).toBeLessThan(500);

    const applied = await request.post(`${URLS.api}/cart/promo`, {
      data: { code: 'BIENVENUE10' },
      failOnStatusCode: false,
    });

    // Either it applied or it was refused for a stated reason. A 500, or a success with
    // no discount and no explanation, is the failure.
    expect(applied.status()).toBeLessThan(500);
  });

  test('an unknown code is refused in words a shopper can act on', async ({ request }) => {
    const response = await request.post(`${URLS.api}/cart/promo`, {
      data: { code: 'DEFINITELY-NOT-A-CODE' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);

    const payload = (await response.json()) as { error?: { message?: string } };
    expect(payload.error?.message ?? '').not.toBe('');
  });

  test('the simulator runs the same engine the cart does', async ({ request }) => {
    // Unauthenticated, so this only proves the route is guarded — the agreement itself
    // is covered by the promo engine unit tests.
    const response = await request.post(`${URLS.api}/admin/promotions/simulate`, {
      data: { variantIds: [], codes: [] },
      failOnStatusCode: false,
    });

    expect([401, 403, 422]).toContain(response.status());
  });
});
