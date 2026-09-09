import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // PRD Section 10.6 sets a 90 % bar on domain logic. Today that is the
      // cross-cutting layer every request passes through; M3 adds the promo engine,
      // the order state machine, the stock ledger and the P&L to this list.
      include: ['src/common/**'],
      exclude: ['src/common/**/*.spec.ts', 'src/common/decorators/**'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
