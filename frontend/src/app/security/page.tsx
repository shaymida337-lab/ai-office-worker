import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrustLayout, TrustList, TrustSection } from "@/components/trust";
import { TRUST_LAST_UPDATED } from "@/lib/trust/constants";

export const metadata: Metadata = {
  title: "אבטחת מידע | נטלי",
  description: "כיצד נטלי מגינה על המידע שלך — עקרונות אבטחה בסיסיים",
};

export default function SecurityPage() {
  return (
    <PublicTrustLayout kicker="אבטחת מידע" title="איך נטלי שומרת על המידע שלך" updatedAt={TRUST_LAST_UPDATED}>
      <TrustSection title="עקרונות בסיסיים">
        <TrustList
          items={[
            "נטלי לא שומרת סיסמת Gmail — ההתחברות ל-Google מתבצעת באמצעות OAuth מאובטח של Google.",
            "הרשאות Google ניתנות לביטול בכל עת, דרך הגדרות השירות או דרך חשבון Google.",
            "גישה למידע מוגבלת לצורך הפעלת השירות — לא לשימושים שאינם קשורים לתהליכי העבודה שהמשתמש מפעיל.",
            "אסימוני גישה נשמרים בצורה מוגנת, והגישה למערכות הפנימיות מוגבלת לפי צורך תפעולי.",
          ]}
        />
      </TrustSection>

      <TrustSection title="מה אנחנו לא מבטיחים">
        <p>
          מסמך זה מתאר את הגישה שלנו לאבטחה — הוא אינו מהווה התחייבות לתקן או הסמכה ספציפית. איננו טוענים לעמידה
          בתקני SOC 2, ISO, HIPAA או GDPR אלא אם צוין אחרת במפורש ובמסמך רשמי נפרד.
        </p>
      </TrustSection>

      <TrustSection title="המלצות למשתמשים">
        <TrustList
          items={[
            "שמרו על חשבון Google מאובטח — סיסמה חזקה ואימות דו-שלבי מומלצים.",
            "בדקו באופן קבוע את האפליקציות המחוברות לחשבון Google שלכם.",
            "נתקו הרשאות שלא בשימוש.",
            "בדקו מידע פיננסי ומסמכים לפני הסתמכות על תוצרים אוטומטיים.",
          ]}
        />
      </TrustSection>

      <TrustSection title="מידע נוסף">
        <p>
          לפרטים על איסוף ושימוש במידע, ראו את <Link href="/privacy" className="font-semibold text-blue-700 hover:underline">מדיניות הפרטיות</Link>.
        </p>
        <p>
          לדיווח על חשש אבטחה: <Link href="/contact" className="font-semibold text-blue-700 hover:underline">יצירת קשר</Link> — בחרו בנושא אבטחה/פרטיות.
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
