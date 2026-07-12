import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrustLayout, TrustList, TrustSection } from "@/components/trust";
import { TRUST_LAST_UPDATED, TRUST_SUPPORT_EMAIL } from "@/lib/trust/constants";

export const metadata: Metadata = {
  title: "מחיקת נתונים",
  description: "הוראות למחיקת נתונים וניתוק הרשאות Google בנטלי",
  alternates: { canonical: "/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <PublicTrustLayout kicker="מחיקת נתונים" title="מדיניות מחיקת נתונים" updatedAt={TRUST_LAST_UPDATED}>
      <TrustSection title="איך לבקש מחיקת נתונים">
        <p>
          ניתן לבקש מחיקת חשבון וכל הנתונים המשויכים אליו באמצעות שליחת מייל אל{" "}
          <a href={`mailto:${TRUST_SUPPORT_EMAIL}`} className="font-semibold text-blue-700 hover:underline">
            {TRUST_SUPPORT_EMAIL}
          </a>
          . יש לציין את כתובת האימייל שבה השתמשת להתחברות לשירות.
        </p>
      </TrustSection>

      <TrustSection title="איזה מידע נמחק">
        <TrustList
          items={[
            "פרטי משתמש וארגון.",
            "אסימוני גישה והרשאות Google שנשמרו במערכת.",
            "נתוני לקוחות, ספקים, משימות, חשבוניות, תשלומים, הודעות ודוחות שנשמרו בשירות.",
            "נתוני סריקה, לוגים עסקיים ותוצרים שנוצרו בתוך המערכת.",
          ]}
        />
      </TrustSection>

      <TrustSection title="ניתוק Google">
        <p>
          בנוסף לבקשת מחיקה מאיתנו, ניתן לנתק את הרשאות Google בכל עת דרך חשבון Google: Google Account → Security →
          Third-party apps with account access → הסרת הגישה של נטלי.
        </p>
      </TrustSection>

      <TrustSection title="זמן טיפול">
        <p>
          בקשות מחיקה יטופלו בדרך כלל בתוך 30 ימים. ייתכן שנשמור מידע מוגבל לתקופה קצרה אם הדבר נדרש לצורכי אבטחה,
          מניעת הונאה, עמידה בדין או גיבויים זמניים.
        </p>
      </TrustSection>

      <TrustSection title="מידע שנמצא אצל Google">
        <p>
          מחיקת הנתונים מהשירות אינה מוחקת אוטומטית קבצים, תיקיות או גיליונות שנוצרו בחשבון Google של המשתמש. המשתמש
          יכול למחוק פריטים אלה ישירות מתוך Google Drive או Google Sheets.
        </p>
      </TrustSection>

      <TrustSection title="מידע נוסף">
        <p>
          <Link href="/privacy" className="font-semibold text-blue-700 hover:underline">
            מדיניות פרטיות
          </Link>
          {" · "}
          <Link href="/contact" className="font-semibold text-blue-700 hover:underline">
            יצירת קשר
          </Link>
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
