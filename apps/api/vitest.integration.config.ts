import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The integration suite — PRD Section 2.3 and the testing contract in Section 5.
 *
 * Separate from the unit config because these need Docker: a Postgres and a Redis are
 * started once for the run by `global-setup.ts`. Keeping them out of `pnpm test` means
 * the fast suite stays fast and still runs on a machine with no daemon.
 *
 *   pnpm --filter @jecks/api test:integration
 *   INTEGRATION_DATABASE_URL=… test:integration   against your own Postgres
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int-spec.ts'],
    globalSetup: ['src/testing/global-setup.ts'],
    setupFiles: ['src/testing/setup.ts'],

    // One worker. These share a database, and two files truncating it at the same
    // moment would fail in a way that looks like a real bug and is not.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,

    // Pulling and starting two images on a cold machine is slower than any assertion.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
