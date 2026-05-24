import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/privacy-policy",
        destination: "/privacy-policy.html",
      },
      {
        source: "/terms",
        destination: "/terms.html",
      },
    ];
  },
};

export default nextConfig;
