import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/money/**', 'src/phone/**'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
