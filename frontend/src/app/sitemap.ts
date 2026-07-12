import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ai-office-worker.com";

// רק עמודי שיווק/אמון ציבוריים אמיתיים. במכוון לא כלולים:
// - נתיבי אפליקציה (dashboard/billing/crm/...) — פרטיים, noindex.
// - /login, /signup — עמודי שירות, noindex.
// - /company — חופף ל-/about; יאוחד לפני שייכנס ל-sitemap.
// - /natalie — דמו; יוחלט אם יהפוך לעמוד המרה מלא לפני הוספה.
// - /status — עמוד תפעולי דק, noindex.
// ללא lastModified — אין לנו תאריך אמין פר-עמוד, ותאריך מזויף גרוע מהיעדרו.
const PUBLIC_MARKETING_PATHS = [
  "/",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/security",
  "/cookies",
  "/data-deletion",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_MARKETING_PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
