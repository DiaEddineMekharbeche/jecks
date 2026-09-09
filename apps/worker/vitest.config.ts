import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // PRD Section 10.6: the P&L arithmetic carries the 90 % bar.
      include: ['src/jobs/**'],
      // media-process's 3D branch needs a real GLB fixture, which arrives with the
      // product editor in M1.2; its image path is fully covered.
      exclude: ['src/jobs/**/*.spec.ts', 'src/jobs/media-process.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
