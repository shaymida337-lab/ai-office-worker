import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ai-office-worker.com";

// נתיבי אפליקציה פרטיים — נחסמים לזחילה (בנוסף ל-noindex בעמודים עצמם).
// login / signup / status / natalie נשארים זחילים בכוונה: הם מקושרים מהאתר
// הציבורי, ולכן גוגל חייב לראות את ה-noindex שלהם (robots.txt לא תחליף).
const PRIVATE_APP_PREFIXES = [
  "/dashboard",
  "/billing",
  "/onboarding",
  "/crm",
  "/tasks",
  "/reports",
  "/payments",
  "/social",
  "/collections",
  "/camera",
  "/message-scans",
  "/auth",
  "/admin",
  "/api",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_APP_PREFIXES,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
