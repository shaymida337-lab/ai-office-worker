import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "מחיקת נתונים | עובד משרד חכם",
  description: "הוראות למחיקת נתונים וניתוק הרשאות Google",
};

export default function DataDeletionPage() {
  return (
    <main className="container">
      <article className="card mx-auto max-w-4xl">
        <div className="page-kicker">מחיקת נתונים</div>
        <h1>מדיניות מחיקת נתונים</h1>
        <p className="mt-3 text-sm text-ink-muted">עודכן לאחרונה: מאי 2026</p>

        <section className="mt-8 grid gap-6 text-ink-secondary">
          <LegalSection title="איך לבקש מחיקת נתונים">
            <p>
              ניתן לבקש מחיקת חשבון וכל הנתונים המשויכים אליו באמצעות שליחת מייל אל{" "}
              <a href="mailto:shaymida337@gmail.com">shaymida337@gmail.com</a>. יש לציין את כתובת האימייל
              שבה השתמשת להתחברות לשירות.
            </p>
          </LegalSection>

          <LegalSection title="איזה מידע נמחק">
            <ul className="list-inside list-disc space-y-2">
              <li>פרטי משתמש וארגון.</li>
              <li>אסימוני גישה והרשאות Google שנשמרו במערכת.</li>
              <li>נתוני לקוחות, ספקים, משימות, חשבוניות, תשלומים, הודעות ודוחות שנשמרו בשירות.</li>
              <li>נתוני סריקה, לוגים עסקיים ותוצרים שנוצרו בתוך המערכת.</li>
            </ul>
          </LegalSection>

          <LegalSection title="ניתוק Google">
            <p>
              בנוסף לבקשת מחיקה מאיתנו, ניתן לנתק את הרשאות Google בכל עת דרך חשבון Google:
              Google Account ואז Security ואז Third-party apps with account access ואז הסרת הגישה של עובד משרד חכם.
            </p>
          </LegalSection>

          <LegalSection title="זמן טיפול">
            <p>
              בקשות מחיקה יטופלו בדרך כלל בתוך 30 ימים. ייתכן שנשמור מידע מוגבל לתקופה קצרה אם הדבר נדרש לצורכי
              אבטחה, מניעת הונאה, עמידה בדין או גיבויים זמניים.
            </p>
          </LegalSection>

          <LegalSection title="מידע שנמצא אצל Google">
            <p>
              מחיקת הנתונים מהשירות אינה מוחקת אוטומטית קבצים, תיקיות או גיליונות שנוצרו בחשבון Google של המשתמש.
              המשתמש יכול למחוק פריטים אלה ישירות מתוך Google Drive או Google Sheets.
            </p>
          </LegalSection>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="btn btn-secondary" href="/privacy-policy">
            מדיניות פרטיות
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
