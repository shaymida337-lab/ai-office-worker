import type { Metadata } from "next";
import { LandingPage } from "@/components/landing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ai-office-worker.com";

export const metadata: Metadata = {
  title: "נטלי — עובדת המשרד הדיגיטלית שלך",
  description:
    "נטלי עוזרת לעסקים בישראל בניהול מיילים, חשבוניות, מסמכים, תשלומים וסדר משרדי — 24/7.",
  openGraph: {
    type: "website",
    locale: "he_IL",
    siteName: "נטלי",
    title: "נטלי — עובדת המשרד הדיגיטלית שלך",
    description:
      "נטלי עוזרת לעסקים בישראל בניהול מיילים, חשבוניות, מסמכים, תשלומים וסדר משרדי — 24/7.",
    url: SITE_URL,
    images: [
      {
        url: "/natalie-portrait.png",
        width: 1200,
        height: 1200,
        alt: "נטלי — עובדת המשרד הדיגיטלית",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "נטלי — עובדת המשרד הדיגיטלית שלך",
    description:
      "נטלי עוזרת לעסקים בישראל בניהול מיילים, חשבוניות, מסמכים, תשלומים וסדר משרדי — 24/7.",
    images: ["/natalie-portrait.png"],
  },
};

export default function HomePage() {
  return <LandingPage />;
}
