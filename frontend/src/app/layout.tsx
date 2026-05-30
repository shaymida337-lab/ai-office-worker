import type { Metadata } from "next";
import { BackendWarmup } from "@/components/BackendWarmup";
import { Footer } from "@/components/Footer";
import { HelpCenter } from "@/components/HelpCenter";
import "./globals.css";

export const metadata: Metadata = {
  title: "עובד משרד חכם",
  description: "עוזר משרד חכם לעסקים בישראל",
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
