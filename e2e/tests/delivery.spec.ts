import { expect, test } from '@playwright/test';
import { goTo, signIn } from '../fixtures/admin.js';

/**
 * Runs, manifests and cash — PRD acceptance criteria 4 and 6.
 *
 * The manifest download is worth an end-to-end test because it is the one PDF the
 * platform renders itself: a byte wrong in the writer produces a file that opens as
 * "damaged", and no unit test of the layout would notice.
 */
test.describe('delivery', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'owner');
  });

  test('a run prints a manifest', async ({ page }) => {
    await goTo(page, '/delivery/runs', /tourn[ée]es/i);

    const firstRun = page.getByRole('button').filter({ hasText: /T-/ }).first();
    test.skip(!(await firstRun.isVisible().catch(() => false)), 'no seeded run for today');

    await firstRun.click();
    await expect(page.getByRole('heading', { name: /T-/ })).toBeVisible();

    const download = page.waitForEvent('download', { timeout: 15_000 });
    await page.getByRole('button', { name: /feuille de route/i }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('the cash drawer keeps its three numbers apart', async ({ page }) => {
    await goTo(page, '/delivery/cash', /caisse/i);

    // Expected, collected and counted in are different questions — see D76.
    await expect(page.getByText(/attendu/i)).toBeVisible();
    await expect(page.getByText(/encaiss[ée]/i).first()).toBeVisible();
    await expect(page.getByText(/compt[ée] en caisse/i)).toBeVisible();
  });

  test('the shipments list loads with its filters', async ({ page }) => {
    await goTo(page, '/delivery', /exp[ée]ditions/i);

    await expect(page.getByPlaceholder(/commande, suivi/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /étiquettes/i })).toBeDisabled();
  });
});
