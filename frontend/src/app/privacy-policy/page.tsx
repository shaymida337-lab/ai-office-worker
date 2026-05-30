import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "מדיניות פרטיות | עובד משרד חכם",
  description: "מדיניות הפרטיות של עובד משרד חכם",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="container">
      <article className="card mx-auto max-w-4xl">
        <div className="page-kicker">מדיניות פרטיות</div>
        <h1>מדיניות פרטיות - עובד משרד חכם</h1>
        <p className="mt-3 text-sm text-ink-muted">עודכן לאחרונה: מאי 2026</p>

        <section className="mt-8 grid gap-6 text-ink-secondary">
          <LegalSection title="מי אנחנו">
            <p>
              עובד משרד חכם הוא שירות אוטומציה עסקית לעסקים בישראל. השירות עוזר למשתמשים לנהל מיילים עסקיים,
              חשבוניות, מסמכי ספקים, משימות, לקוחות, דוחות ותהליכי עבודה.
            </p>
          </LegalSection>

          <LegalSection title="איזה מידע אנו אוספים">
            <ul className="list-inside list-disc space-y-2">
              <li>פרטי חשבון בסיסיים: שם, כתובת אימייל ומזהה משתמש.</li>
              <li>נתוני ג׳ימייל שהמשתמש מאשר לקריאה, לצורך זיהוי מסמכים עסקיים, חשבוניות, דרישות תשלום ולידים.</li>
              <li>קבצים ותיקיות שהשירות יוצר או מנהל בדרייב עבור מסמכים עסקיים.</li>
              <li>גיליונות שהשירות יוצר או מעדכן בשיטס עבור תשלומים, משימות, חשבוניות ודוחות.</li>
              <li>נתונים עסקיים שהמשתמש מזין או שהמערכת מפיקה: לקוחות, ספקים, משימות, הודעות, דוחות וסטטוסים.</li>
            </ul>
          </LegalSection>

          <LegalSection title="איך אנו משתמשים במידע">
            <ul className="list-inside list-disc space-y-2">
              <li>סריקת מיילים עסקיים כדי לזהות חשבוניות, קבלות, דרישות תשלום, ספקים, לקוחות ולידים.</li>
              <li>שמירת מסמכים בתיקיות דרייב שהשירות יוצר או מנהל עבור המשתמש.</li>
              <li>יצירה ועדכון של גיליונות שיטס לניהול תשלומים, משימות ודוחות.</li>
              <li>הצגת מידע עסקי בדשבורד, כולל התראות, משימות ותהליכים פתוחים.</li>
              <li>שליחת מיילי המשך כאשר המשתמש מפעיל פעולה כזו מתוך המערכת.</li>
            </ul>
          </LegalSection>

          <LegalSection title="שימוש בנתוני Google API">
            <p>
              השימוש שלנו במידע שמתקבל מ-Google APIs עומד במדיניות Google API Services User Data Policy, כולל
              דרישות Limited Use. אנו משתמשים בהרשאות Google רק כדי לספק את הפונקציות שהמשתמש מפעיל בשירות,
              ולא מוכרים או משתפים נתוני Google עם צדדים שלישיים לצורכי פרסום.
            </p>
          </LegalSection>

          <LegalSection title="שיתוף מידע">
            <p>
              איננו מוכרים מידע אישי. מידע עשוי להישמר אצל ספקי תשתית הדרושים להפעלת השירות, כגון אירוח, מסד נתונים
              ושירותי API, בכפוף לאמצעי אבטחה ולמטרת הפעלת השירות בלבד.
            </p>
          </LegalSection>

          <LegalSection title="שמירת מידע ומחיקה">
            <p>
              אנו שומרים מידע כל עוד החשבון פעיל או כל עוד הוא נחוץ להפעלת השירות. ניתן לבקש מחיקת חשבון ונתונים
              באמצעות פנייה לכתובת התמיכה. ניתן גם לנתק גישה לחשבון Google דרך הגדרות חשבון Google.
            </p>
          </LegalSection>

          <LegalSection title="אבטחת מידע">
            <p>
              אנו משתמשים באמצעי אבטחה סבירים כדי להגן על נתוני המשתמשים, כולל שמירת אסימוני גישה באופן מוגן והגבלת
              גישה למידע לפי צורך תפעולי.
            </p>
          </LegalSection>

          <LegalSection title="יצירת קשר">
            <p>
              לשאלות בנוגע לפרטיות או למחיקת נתונים:{" "}
              <a href="mailto:shaymida337@gmail.com">shaymida337@gmail.com</a>
            </p>
          </LegalSection>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="btn btn-secondary" href="/">
            חזרה לדף הבית
          </Link>
          <Link className="btn btn-secondary" href="/terms">
            תנאי שימוש
          </Link>
        </div>
      </article>
    </main>
  );
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="mt-3 leading-8">{children}</div>
    </section>
  );
}
