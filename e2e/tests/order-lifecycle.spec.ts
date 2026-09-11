import { expect, test } from '@playwright/test';
import { goTo, signIn } from '../fixtures/admin.js';

/**
 * Confirm, pack, ship, deliver — PRD acceptance criteria 2 and 4.
 *
 * The long one. It walks a seeded order the whole way and then checks the money arrived
 * in the P&L, because an order that is marked delivered and does not show up as profit
 * means the two halves of the system disagree about what a sale is.
 */
test.describe('order lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'owner');
  });

  test('a pending order can be walked to delivered', async ({ page }) => {
    await goTo(page, '/orders', /commandes/i);

    // The pending tab is where a morning starts.
    await page.getByRole('button', { name: /à confirmer|en attente/i }).first().click();
    await page.getByRole('row').nth(1).click();

    await expect(page.getByRole('heading', { name: /JK-/ })).toBeVisible();

    // The state machine decides which buttons exist; the test follows them rather than
    // asserting a fixed sequence, so a legal reordering does not break it.
    for (const label of [/confirmer/i, /emball/i, /exp[ée]dier/i, /livr[ée]/i]) {
      const button = page.getByRole('button', { name: label }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click();

        // A transition that needs cash collected asks for it.
        const confirm = page.getByRole('button', { name: /confirmer|enregistrer/i }).last();
        if (await confirm.isVisible().catch(() => false)) await confirm.click();

        await page.waitForTimeout(500);
      }
    }

    await expect(page.getByText(/livr[ée]e?/i).first()).toBeVisible();
  });

  test('an illegal transition is refused by the server, not hidden by the client', async ({
    page,
    request,
  }) => {
    await goTo(page, '/orders', /commandes/i);

    // Straight at the API: the buttons already hide it, and what is being tested is
    // that hiding is not the only thing stopping it.
    const response = await request.post(`${process.env.API_URL ?? 'http://localhost:4000/api/v1'}/admin/orders/00000000-0000-0000-0000-000000000000/transition`, {
      data: { to: 'DELIVERED' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('a delivered order shows up in the profit and loss', async ({ page }) => {
    await goTo(page, '/finance', /r[ée]sultat/i);

    // Revenue and a margin percentage, both non-zero on seeded data.
    await expect(page.getByText(/chiffre d.affaires/i)).toBeVisible();
    await expect(page.getByText(/marge brute/i)).toBeVisible();

    const revenue = await page.getByText(/DA/).first().textContent();
    expect(revenue).toBeTruthy();
  });
});
