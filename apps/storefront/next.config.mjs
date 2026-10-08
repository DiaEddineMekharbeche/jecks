import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Next only reads .env files inside the app directory, but the monorepo keeps one .env
// at the root (PRD Section 10.10). Load it first; anything already set wins, so a
// per-app override and the real environment still take precedence.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: resolve(repoRoot, '.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Traces the files the server actually needs, which is what Dockerfile.storefront
  // copies. Without it the runtime image would have to carry node_modules.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  // The workspace packages ship TypeScript source, so Next must compile them.
  transpilePackages: ['@jecks/ui', '@jecks/shared'],
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.jecks.dz' },
    ],
  },
  experimental: {
    // Only the icons actually used are bundled, which matters for the LCP budget.
    optimizePackageImports: ['lucide-react', '@react-three/drei'],
  },
  // Set on Vercel, where the browser must reach the API over HTTPS but the API is an HTTP
  // address on the VPS. The storefront forwards /api/v1/* itself, so the browser only ever
  // talks to its own origin: no mixed content, no CORS, first-party cookies (D114).
  async rewrites() {
    const target = process.env.API_PROXY_TARGET;
    if (!target) return [];
    return [{ source: '/api/v1/:path*', destination: `${target.replace(/\/$/, '')}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
