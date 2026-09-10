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
      // PRD Section 10.6 sets a 90 % bar on domain logic: the cross-cutting layer every
      // request passes through, plus the calculations that decide money and stock.
      // M4 adds the order state machine and the settlement math to this list.
      include: [
        'src/common/**',
        'src/modules/promotions/engine/**',
        'src/modules/inventory/costing.ts',
        'src/modules/inventory/stock-ledger.service.ts',
      ],
      exclude: [
        '**/*.spec.ts',
        'src/common/decorators/**',
        // Declaration-only: no runtime statements to cover.
        'src/modules/promotions/engine/types.ts',
      ],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
