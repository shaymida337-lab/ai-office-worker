import type { Metadata, Viewport } from "next";
import { BackendWarmup } from "@/components/BackendWarmup";
import { Footer } from "@/components/Footer";
import { HelpCenter } from "@/components/HelpCenter";
import "./globals.css";

export const metadata: Metadata = {
  title: "עובד משרד חכם",
  description: "עוזר משרד חכם לעסקים בישראל",
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
      <body>
        <BackendWarmup />
        {children}
        <Footer />
        <HelpCenter />
      </body>
    </html>
  );
}
