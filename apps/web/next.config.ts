import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A self-contained server (.next/standalone) for the Docker image: no node_modules needed.
  output: 'standalone',
  // Language files are loaded one by one from @ap/i18n's source (see lib/i18n.ts).
  transpilePackages: ['@ap/i18n'],
  // The monorepo root (one pnpm lockfile for every package).
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // Linting is not part of this package's pipeline (typecheck + tests are).
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      {
        // The service worker must always be revalidated so updates roll out quickly.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
