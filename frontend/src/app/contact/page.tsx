import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrustLayout, TrustSection } from "@/components/trust";
import { TRUST_COMPANY_NAME, TRUST_SUPPORT_EMAIL } from "@/lib/trust/constants";

export const metadata: Metadata = {
  title: "יצירת קשר | נטלי",
  description: "צרו קשר עם צוות נטלי — תמיכה, פניות עסקיות ושאלות פרטיות ואבטחה",
};

export default function ContactPage() {
  return (
    <PublicTrustLayout kicker="יצירת קשר" title="איך לפנות אלינו">
      <TrustSection title="תמיכה כללית">
        <p>
          לשאלות על השימוש בנטלי, בעיות טכניות או עזרה בהפעלה — כתבו לנו:{" "}
          <a href={`mailto:${TRUST_SUPPORT_EMAIL}`} className="font-semibold text-blue-700 hover:underline">
            {TRUST_SUPPORT_EMAIL}
          </a>
        </p>
      </TrustSection>

      <TrustSection title="פניות עסקיות">
        <p>
          לשיתופי פעולה, הצעות ארגוניות או פניות מסחריות —{" "}
          <a
            href={`mailto:${TRUST_SUPPORT_EMAIL}?subject=פנייה%20עסקית%20-%20נטלי`}
            className="font-semibold text-blue-700 hover:underline"
          >
            {TRUST_SUPPORT_EMAIL}
          </a>
          . נשמח לחזור אליכם בהקדם האפשרי.
        </p>
        <p className="text-sm text-slate-500">גוף מפעיל: {TRUST_COMPANY_NAME}</p>
      </TrustSection>

      <TrustSection title="פרטיות ואבטחה">
        <p>
          לשאלות על מדיניות הפרטיות, מחיקת מידע או דיווח על חשש אבטחה:{" "}
          <a
            href={`mailto:${TRUST_SUPPORT_EMAIL}?subject=פרטיות%20או%20אבטחה%20-%20נטלי`}
            className="font-semibold text-blue-700 hover:underline"
          >
            {TRUST_SUPPORT_EMAIL}
          </a>
        </p>
        <p>
          מידע נוסף: <Link href="/privacy" className="font-semibold text-blue-700 hover:underline">מדיניות פרטיות</Link>,{" "}
          <Link href="/cookies" className="font-semibold text-blue-700 hover:underline">מדיניות עוגיות</Link>,{" "}
          <Link href="/security" className="font-semibold text-blue-700 hover:underline">אבטחה</Link>,{" "}
          <Link href="/data-deletion" className="font-semibold text-blue-700 hover:underline">מחיקת נתונים</Link>.
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
