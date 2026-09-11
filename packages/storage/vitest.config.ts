import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/index.ts'],
      // The S3 verbs need a live bucket to exercise; the local driver, the key guard
      // and the configuration resolution — where the bugs actually were — are covered.
      thresholds: { lines: 60, functions: 70, branches: 80, statements: 60 },
    },
  },
});
