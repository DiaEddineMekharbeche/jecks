import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    // `node` rather than jsdom: what is worth testing here is the dictionary contract
    // and the cart store's reducer behaviour, neither of which needs a DOM. Rendering
    // tests would need jsdom plus three more dependencies for very little more truth.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
