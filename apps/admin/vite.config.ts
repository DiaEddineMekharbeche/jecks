import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The repo-root .env is the single source of truth (PRD Section 10.10).
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');

  return {
    plugins: [react()],
    envDir: resolve(__dirname, '../..'),
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    server: {
      port: Number(env.ADMIN_PORT ?? 5174),
      strictPort: true,
      proxy: {
        // Same-origin in dev, so the httpOnly refresh cookie needs no CORS exception.
        // The target is an explicit IPv4 literal: Vite binds IPv6 loopback, and
        // resolving `localhost` here again is what breaks when the two ends of the
        // proxy disagree about the address family.
        '/api': {
          target: env.API_URL?.replace('localhost', '127.0.0.1') ?? 'http://127.0.0.1:4000',
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split the heavy admin-only libraries so the login screen stays small.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            table: ['@tanstack/react-table'],
          },
        },
      },
    },
  };
});
