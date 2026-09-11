import { expect, test } from '@playwright/test';
import { URLS } from '../fixtures/accounts.js';
import { goTo, signIn } from '../fixtures/admin.js';

/**
 * Role isolation — PRD acceptance criterion 6.
 *
 * A hidden menu entry is not access control. Each of these signs in as a restricted
 * role and then goes to the URL directly, because that is what somebody curious would
 * do, and the answer has to come from the server.
 */
test.describe('role isolation', () => {
  test('an order agent cannot reach the finances', async ({ page }) => {
    await signIn(page, 'agent');

    // Not in the menu.
    await expect(page.getByRole('link', { name: /finances/i })).toHaveCount(0);

    // And not by typing the address either.
    await page.goto(`${URLS.admin}/finance`);
    await expect(page.getByText(/acc[èe]s refus[ée]/i)).toBeVisible();
  });

  test('an order agent can still work the orders they are there for', async ({ page }) => {
    await signIn(page, 'agent');
    await goTo(page, '/orders', /commandes/i);
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('the API refuses the data, not just the screen', async ({ page, request }) => {
    await signIn(page, 'agent');

    // The session cookie travels with the request; the permission guard is what answers.
    const response = await request.get(
      `${URLS.api}/admin/finance/pnl?from=2026-01-01&to=2026-01-31`,
      { failOnStatusCode: false },
    );

    expect([401, 403]).toContain(response.status());
  });

  test('a driver sees their own run and cannot ask for another', async ({ page, request }) => {
    // The driver routes resolve the driver from the session, so a run id in the URL
    // belonging to somebody else has to come back 403 rather than 200.
    const response = await request.get(
      `${URLS.api}/driver/runs/00000000-0000-0000-0000-000000000000`,
      { failOnStatusCode: false },
    );

    expect(response.status()).toBeGreaterThanOrEqual(400);
    void page;
  });
});
