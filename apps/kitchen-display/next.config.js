/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@prolific/shared-types', '@prolific/utils', '@prolific/ui'],
};

module.exports = nextConfig;
