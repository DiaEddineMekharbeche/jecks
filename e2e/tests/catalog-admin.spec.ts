import { expect, test } from '@playwright/test';
import { URLS } from '../fixtures/accounts.js';
import { goTo, signIn } from '../fixtures/admin.js';

/**
 * A product created in the admin appears in the shop — PRD acceptance criterion 3.
 *
 * Also the cache test that matters: the catalogue is served from Redis, so a product
 * that is saved and does not appear means an invalidation is missing, and a shop would
 * discover that as "the site is broken" days later.
 */
test.describe('catalog', () => {
  test('a new product reaches the storefront', async ({ page, context }) => {
    await signIn(page, 'owner');
    await goTo(page, '/catalog/products', /produits/i);

    const name = `Casquette test ${Date.now()}`;

    await page.getByRole('button', { name: /nouveau produit|ajouter/i }).first().click();
    await page.getByLabel(/nom/i).first().fill(name);
    await page.getByRole('button', { name: /enregistrer|cr[ée]er/i }).first().click();

    await expect(page.getByText(/enregistr|cr[éeè]/i).first()).toBeVisible({ timeout: 15_000 });

    // Published products only; a draft correctly never appears.
    const publish = page.getByRole('switch', { name: /publi/i }).first();
    if (await publish.isVisible().catch(() => false)) {
      await publish.click();
      await page.getByRole('button', { name: /enregistrer/i }).first().click();
    }

    const shopper = await context.newPage();
    await shopper.goto(`${URLS.storefront}/fr/recherche?q=${encodeURIComponent('Casquette test')}`);

    // If this times out, the cache was not cleared by the write.
    await expect(shopper.getByText(name)).toBeVisible({ timeout: 20_000 });
  });

  test('a CSV import reports what it could not read', async ({ page }) => {
    await signIn(page, 'owner');
    await goTo(page, '/catalog/products', /produits/i);

    const importButton = page.getByRole('button', { name: /importer/i }).first();
    test.skip(!(await importButton.isVisible().catch(() => false)), 'import not on this screen');

    await importButton.click();

    // A file missing a required column: the report is the feature, not the upload.
    await page.setInputFiles('input[type=file]', {
      name: 'products.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,price\nCasquette sans SKU,2500\n', 'utf8'),
    });

    await expect(page.getByText(/colonne|manquant|erreur/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
