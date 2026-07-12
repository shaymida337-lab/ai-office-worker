import type { Metadata } from "next";

// אזור אדמין פלטפורמה — לא לאינדוקס.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
