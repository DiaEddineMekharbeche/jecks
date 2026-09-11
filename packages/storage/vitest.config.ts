import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/index.ts'],
      // The S3 driver is covered against a stubbed fetch, signature included; what is
      // left is filesystem error branches that would need a read-only disk to reach.
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
