import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GoogleTagManagerBody, GoogleTagManagerHead, GtmPageView } from "@/components/analytics";
import { BackendWarmup } from "@/components/BackendWarmup";
import { HelpCenter } from "@/components/HelpCenter";
import { NatalieAssistantWidget } from "@/components/NatalieAssistantWidget";
import { ThemeProvider } from "@/components/natalie-ui/ThemeProvider";
import { I18nProvider } from "@/i18n";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ai-office-worker.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "נטלי — עובדת המשרד הדיגיטלית שלך",
    template: "%s | נטלי",
  },
  description:
    "נטלי — עובדת משרד דיגיטלית מבוססת AI לעסקים קטנים: מיילים, חשבוניות, יומן, משימות ומסמכים במקום אחד.",
  applicationName: "נטלי",
  openGraph: {
    type: "website",
    siteName: "נטלי",
    locale: "he_IL",
    // תמונת שיתוף כברירת מחדל לכל עמוד — כרטיס שיתוף מעוצב גם מחוץ לדף הבית
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "נטלי — עובדת המשרד הדיגיטלית" }],
  },
  twitter: {
    card: "summary_large_image",
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#1d5bff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <GoogleTagManagerHead />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('natalie-theme');if(t!=='light')document.documentElement.classList.add('dark');var l=localStorage.getItem('natalie-language');if(l==='en'||l==='he'){document.documentElement.lang=l;document.documentElement.dir=l==='he'?'rtl':'ltr';}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-auto overflow-x-hidden lg:overflow-x-clip lg:overflow-y-visible">
        <I18nProvider>
          <ThemeProvider>
          <GoogleTagManagerBody />
          <Suspense fallback={null}>
            <GtmPageView />
          </Suspense>
          <BackendWarmup />
          {children}
          <HelpCenter />
          <NatalieAssistantWidget />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
