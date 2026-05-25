import type { Metadata } from "next";
import { HelpCenter } from "@/components/HelpCenter";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Office Worker",
  description: "עוזר משרד AI לעסקים בישראל",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>
        {children}
        <HelpCenter />
      </body>
    </html>
  );
}
