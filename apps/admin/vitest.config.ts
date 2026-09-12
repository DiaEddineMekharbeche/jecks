import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Tests for the admin — PRD Section 10.6.
 *
 * `jsdom`, unlike the storefront's node-only suite, because what is worth testing here
 * needs one: the permission gate that decides whether a screen renders at all, and two
 * hand-written map projections whose correctness is geographic rather than arithmetic.
 *
 * What is deliberately not here is snapshot tests of markup. They fail on every design
 * change and pass through every real defect.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // The logic that decides access, money and URL state. Screens are covered by the
      // end-to-end suite, which exercises them the way an operator does.
      include: [
        'src/lib/errors.ts',
        'src/lib/api.ts',
        'src/features/dashboard/WilayaMap.tsx',
        'src/features/delivery/RunMap.tsx',
      ],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
