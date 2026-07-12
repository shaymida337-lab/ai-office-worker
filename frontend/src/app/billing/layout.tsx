import type { Metadata } from "next";
import { BillingShell } from "./BillingShell";

// עמודי billing פרטיים — לא לאינדוקס. ה-layout הפך ל-Server Component רק כדי
// להצהיר metadata; כל ההתנהגות הקודמת נשמרה ב-BillingShell (Client).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function BillingRootLayout({ children }: { children: React.ReactNode }) {
  return <BillingShell>{children}</BillingShell>;
}
