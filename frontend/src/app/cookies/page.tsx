import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrustLayout, TrustList, TrustSection } from "@/components/trust";
import { TRUST_LAST_UPDATED } from "@/lib/trust/constants";

export const metadata: Metadata = {
  title: "מדיניות עוגיות",
  description: "מדיניות העוגיות של נטלי — אילו עוגיות בשימוש וכיצד לנהל העדפות",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <PublicTrustLayout kicker="מדיניות עוגיות" title="שימוש בעוגיות (Cookies)" updatedAt={TRUST_LAST_UPDATED}>
      <TrustSection title="מהן עוגיות">
        <p>
          עוגיות הן קבצי טקסט קטנים שנשמרים בדפדפן שלך כשאתה משתמש באתר. הן עוזרות לזכור העדפות, לשמור על חיבור מאובטח
          ולשפר את חוויית השימוש.
        </p>
      </TrustSection>

      <TrustSection title="אילו עוגיות אנו משתמשים">
        <TrustList
          items={[
            "עוגיות הכרחיות — נדרשות להפעלת האתר, התחברות מאובטחת ושמירת מצב בסיסי של החשבון.",
            "עוגיות פונקציונליות — לזכור העדפות תצוגה והגדרות שבחרת בממשק.",
            "עוגיות ביצועים — לסייע בהבנת שימוש כללי באתר (באגרגציה) לשיפור השירות.",
          ]}
        />
      </TrustSection>

      <TrustSection title="עוגיות של צדדים שלישיים">
        <p>
          בעת התחברות באמצעות Google או שימוש בשירותי תשלום, ספקים אלה עשויים להציב עוגיות משלהם בהתאם למדיניות שלהם.
          איננו שולטים בעוגיות אלה — מומלץ לעיין במדיניות הפרטיות של הספק הרלוונטי.
        </p>
      </TrustSection>

      <TrustSection title="ניהול העדפות">
        <p>
          ניתן למחוק עוגיות או לחסום אותן דרך הגדרות הדפדפן. חסימת עוגיות הכרחיות עלולה להשפיע על יכולת ההתחברות
          והשימוש בשירות.
        </p>
      </TrustSection>

      <TrustSection title="מידע נוסף">
        <p>
          לפרטים על איסוף ושימוש במידע אישי, ראו את{" "}
          <Link href="/privacy" className="font-semibold text-blue-700 hover:underline">
            מדיניות הפרטיות
          </Link>
          . לשאלות:{" "}
          <Link href="/contact" className="font-semibold text-blue-700 hover:underline">
            יצירת קשר
          </Link>
          .
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
