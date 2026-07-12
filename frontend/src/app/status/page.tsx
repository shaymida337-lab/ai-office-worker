import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "סטטוס שירות",
  description: "מצב זמינות בסיסי של שירות נטלי",
  robots: { index: false, follow: false },
};

export { default } from "./StatusClient";
