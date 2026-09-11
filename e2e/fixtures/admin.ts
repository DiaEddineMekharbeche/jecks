import { expect, type Page } from '@playwright/test';
import { ACCOUNTS, URLS } from './accounts.js';

/**
 * Signing into the admin.
 *
 * Done through the form rather than by injecting a token, because the form is part of
 * what these tests are for: a session that works in a unit test and not in a browser is
 * the exact failure an end-to-end suite exists to catch.
 */
export async function signIn(page: Page, account: keyof typeof ACCOUNTS = 'owner'): Promise<void> {
  const { email, password } = ACCOUNTS[account];

  await page.goto(`${URLS.admin}/login`);
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole('button', { name: /connexion|se connecter/i }).click();

  // The dashboard and the driver view are both valid landings, depending on the role.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** Navigates within the admin and waits for the page heading to settle. */
export async function goTo(page: Page, path: string, heading: RegExp): Promise<void> {
  await page.goto(`${URLS.admin}${path}`);
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}
