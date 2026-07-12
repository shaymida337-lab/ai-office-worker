import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async redirects() {
    return [
      // קבצי HTML משפטיים ישנים שהוסרו מ-public/ — ייתכן שקישורים חיצוניים
      // (למשל Google OAuth Console) עדיין מפנים אליהם.
      { source: "/privacy-policy.html", destination: "/privacy", permanent: true },
      { source: "/terms.html", destination: "/terms", permanent: true },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
