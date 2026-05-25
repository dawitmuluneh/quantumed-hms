import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Disable minification — Next 15's SWC minifier intermittently throws
  // `_webpack.WebpackError is not a constructor` in monorepo workspaces.
  // We accept a slightly larger bundle in Phase A; revisit when Next/SWC
  // stabilises (Phase D).
  webpack: (config) => {
    config.optimization = { ...config.optimization, minimize: false };
    return config;
  },
  transpilePackages: ['@quantumed/ui', '@quantumed/shared-types', '@quantumed/i18n'],
};

export default withNextIntl(nextConfig);
