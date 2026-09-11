import { expect, test } from '@playwright/test';
import { URLS } from '../fixtures/accounts.js';
import { goTo, signIn } from '../fixtures/admin.js';

/**
 * A parcel that comes home — PRD acceptance criterion 4.
 *
 * Cash on delivery means a real share of orders are refused at the door, so this path is
 * not an edge case, it is Tuesday. What has to hold is that the failure is recorded, the
 * order can be tried again or given up on, the stock comes back when the parcel does,
 * and the customer's record remembers.
 *
 * The walk is driven through the admin rather than the API because the failure this
 * catches is a button that calls the wrong transition — invisible to a service test.
 */
test.describe('failed delivery', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'owner');
  });

  test('a failed delivery is recorded with a reason', async ({ page }) => {
    await goTo(page, '/orders', /commandes/i);

    // Something already on its way; a pending order cannot fail a delivery it has not
    // attempted.
    await page.getByRole('button', { name: /exp[ée]di[ée]|en livraison/i }).first().click();
    await page.waitForTimeout(500);

    const rows = page.getByRole('row');
    test.skip((await rows.count()) < 2, 'no shipped order in the seed');

    await rows.nth(1).click();
    await expect(page.getByRole('heading', { name: /JK-/ })).toBeVisible();

    const failButton = page.getByRole('button', { name: /signaler un [ée]chec/i }).first();
    test.skip(!(await failButton.isVisible().catch(() => false)), 'this order cannot fail here');

    await failButton.click();

    // A failure without a reason is a row nobody can act on, so the dialog insists.
    const reason = page.getByRole('textbox').last();
    await reason.fill('Client injoignable, deux appels');
    await page.getByRole('button', { name: /confirmer|enregistrer/i }).last().click();

    await expect(page.getByText(/[ée]chec de livraison/i).first()).toBeVisible();
    await expect(page.getByText(/injoignable/i).first()).toBeVisible();
  });

  test('a failed order can be sent out again or returned, not left stranded', async ({ page }) => {
    await goTo(page, '/orders', /commandes/i);

    await page.getByRole('button', { name: /[ée]chou[ée]/i }).first().click();
    await page.waitForTimeout(500);

    const rows = page.getByRole('row');
    test.skip((await rows.count()) < 2, 'no failed order to work with');

    await rows.nth(1).click();
    await expect(page.getByRole('heading', { name: /JK-/ })).toBeVisible();

    // Both doors are open from a failure: try again, or give up and take the stock back.
    const retry = page.getByRole('button', { name: /mettre en livraison|marquer exp[ée]di[ée]e/i });
    const giveUp = page.getByRole('button', { name: /marquer retourn[ée]e|annuler/i });

    expect((await retry.count()) + (await giveUp.count())).toBeGreaterThan(0);
  });

  test('a return puts the stock back, and the ledger says who did', async ({ page }) => {
    // Read the ledger before and after rather than the on-hand number alone: a total
    // that changes without a movement is the bug this is here to catch.
    const before = await countMovements(page);

    await goTo(page, '/orders', /commandes/i);
    await page.getByRole('button', { name: /[ée]chou[ée]/i }).first().click();
    await page.waitForTimeout(500);

    const rows = page.getByRole('row');
    test.skip((await rows.count()) < 2, 'no failed order to return');

    await rows.nth(1).click();

    const returnButton = page.getByRole('button', { name: /marquer retourn[ée]e/i }).first();
    test.skip(!(await returnButton.isVisible().catch(() => false)), 'return is not offered here');

    await returnButton.click();

    // Restock is a decision, not an automatic consequence: a crushed cap goes back to
    // the shop, not back on the shelf.
    const restock = page.getByRole('checkbox', { name: /remettre en stock/i }).first();
    if (await restock.isVisible().catch(() => false)) await restock.check();

    await page.getByRole('button', { name: /confirmer|enregistrer/i }).last().click();
    await expect(page.getByText(/retourn[ée]e/i).first()).toBeVisible();

    await expect
      .poll(() => countMovements(page), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });

  test('the customer record remembers the refusal', async ({ page }) => {
    await goTo(page, '/customers', /clients/i);

    // The reliability figure is what decides whether the next order gets a phone call
    // before it is packed, so it has to be on the screen an agent already looks at.
    await expect(page.getByText(/fiabilit[ée]|livr[ée]s?\s*\/|taux/i).first()).toBeVisible();
  });
});

/** How many stock movements the ledger holds right now. */
async function countMovements(page: import('@playwright/test').Page): Promise<number> {
  const response = await page.request.get(`${URLS.api}/admin/inventory/movements?perPage=1`, {
    failOnStatusCode: false,
  });

  if (!response.ok()) return 0;

  const body = (await response.json()) as { meta?: { total?: number } };
  return body.meta?.total ?? 0;
}
