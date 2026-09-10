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
      // request passes through, plus every calculation that decides money, stock or an
      // order's fate. M4 adds routing, settlement arithmetic and the courier adapters;
      // M5 adds the P&L.
      include: [
        'src/common/**',
        'src/modules/promotions/engine/**',
        'src/modules/orders/domain/**',
        'src/modules/inventory/costing.ts',
        'src/modules/inventory/stock-ledger.service.ts',
        'src/modules/delivery/domain/**',
        'src/modules/couriers/**',
      ],
      exclude: [
        '**/*.spec.ts',
        // Dependency-injection wiring: no branch of its own to exercise.
        '**/*.module.ts',
        'src/common/decorators/**',
        // Declaration-only: no runtime statements to cover.
        'src/modules/promotions/engine/types.ts',
      ],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
