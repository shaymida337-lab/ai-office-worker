import type { Metadata, Viewport } from "next";
import { BackendWarmup } from "@/components/BackendWarmup";
import { HelpCenter } from "@/components/HelpCenter";
import { NatalieAssistantWidget } from "@/components/NatalieAssistantWidget";
import "./globals.css";

export const metadata: Metadata = {
  title: "נטלי",
  description: "נטלי — עובדת המשרד שלך. עוזרת AI לעסקים בישראל",
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
      <body className="overflow-x-hidden">
        <BackendWarmup />
        {children}
        <HelpCenter />
        <NatalieAssistantWidget />
      </body>
    </html>
  );
}
