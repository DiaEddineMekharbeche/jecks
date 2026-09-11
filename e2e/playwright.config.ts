import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests — PRD Section 10.6 and M7.
 *
 * These run against a real stack: Postgres, Redis, the API, the worker, the storefront
 * and the admin, all seeded. That is the point. Everything below this level is already
 * covered by unit tests; what these catch is the seam — a checkout that prices right and
 * still fails because the cart cookie is scoped wrong.
 *
 *   pnpm e2e:install                            once, downloads Chromium
 *   pnpm docker:up && pnpm db:reset && pnpm db:seed
 *   pnpm dev
 *   pnpm e2e
 */
export default defineConfig({
  testDir: './tests',
  // Serial by default: these share one database, and two specs confirming the same
  // seeded order would fight over its state.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env.STOREFRONT_URL ?? 'http://localhost:3000',
    // Kept only for a failure: a video per passing test is a gigabyte of nothing.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'fr-DZ',
    timezoneId: 'Africa/Algiers',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      // The storefront is used on a phone by most Algerian shoppers, so at least the
      // checkout runs there too.
      name: 'mobile',
      testMatch: /checkout\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
});
