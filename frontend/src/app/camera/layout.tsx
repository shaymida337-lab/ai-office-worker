import type { Metadata } from "next";

// עמוד אפליקציה פרטי — לא לאינדוקס. layout מינימלי שקיים רק בשביל metadata
// (עמודי הסגמנט הם Client Components ולא יכולים להצהיר על metadata בעצמם).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PrivateSegmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
