/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL}/api/:path*`,
      },
      {
        source: '/privacy-policy',
        destination: '/privacy-policy.html',
      },
      {
        source: '/terms',
        destination: '/terms.html',
      },
    ];
  },
};

module.exports = nextConfig;
