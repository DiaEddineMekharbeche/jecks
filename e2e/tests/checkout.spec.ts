import { expect, test } from '@playwright/test';
import { URLS, uniquePhone } from '../fixtures/accounts.js';

/**
 * Guest cash-on-delivery checkout — PRD acceptance criterion 1.
 *
 * The flow every other feature exists to support: find a cap, add it, give a phone
 * number and an address, and get an order number back. No account, because almost
 * nobody makes one.
 */
test.describe('guest checkout', () => {
  test('a visitor can buy a cap without an account', async ({ page }) => {
    await page.goto('/fr');

    // Into the catalogue and onto the first product.
    await page.getByRole('link', { name: /casquettes|boutique|catalogue/i }).first().click();
    await page.getByRole('link', { name: /casquette/i }).first().click();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // A size has to be chosen before the cart will take it.
    const sizes = page.getByRole('radio');
    if (await sizes.first().isVisible().catch(() => false)) {
      await sizes.first().click();
    }

    await page.getByRole('button', { name: /ajouter au panier/i }).click();

    // The drawer opens with the line in it.
    await expect(page.getByText(/panier/i).first()).toBeVisible();
    await page.getByRole('link', { name: /commander|passer la commande/i }).first().click();

    await expect(page).toHaveURL(/checkout|commande/);

    const phone = uniquePhone();
    await page.getByLabel(/nom/i).first().fill('Yacine Benali');
    await page.getByLabel(/t[ée]l[ée]phone/i).first().fill(phone);

    // Wilaya then commune: the second only loads once the first is chosen.
    await page.getByLabel(/wilaya/i).click();
    await page.getByRole('option', { name: /alger/i }).first().click();

    await page.getByLabel(/commune/i).click();
    await page.getByRole('option').first().click();

    await page.getByLabel(/adresse/i).first().fill('Cité 300 logements, bâtiment C');

    // The total has to be on screen before it is agreed to.
    await expect(page.getByText(/total/i).first()).toBeVisible();

    await page.getByRole('button', { name: /confirmer|valider la commande/i }).click();

    // An order number, which is what the shopper will quote on the phone.
    await expect(page.getByText(/JK-\d{6}-\d{4}/)).toBeVisible({ timeout: 20_000 });
  });

  test('the delivery fee changes with the wilaya', async ({ page, request }) => {
    // Read straight from the quote endpoint: the arithmetic is tested in unit tests,
    // what matters here is that the storefront and the API agree on the shape.
    const alger = await request.get(`${URLS.api}/shipping/quote?wilayaCode=16&deliveryType=HOME`);
    const tamanrasset = await request.get(
      `${URLS.api}/shipping/quote?wilayaCode=11&deliveryType=HOME`,
    );

    expect(alger.ok()).toBeTruthy();
    expect(tamanrasset.ok()).toBeTruthy();

    const near = (await alger.json()) as { data: { price: string } };
    const far = (await tamanrasset.json()) as { data: { price: string } };

    // The deep south costs more to reach than the capital. If it ever does not, the
    // rate table has been wiped.
    expect(BigInt(far.data.price)).toBeGreaterThan(BigInt(near.data.price));
    void page;
  });
});
