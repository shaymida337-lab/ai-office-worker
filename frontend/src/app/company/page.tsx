import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "פרטי חברה | עובד משרד חכם",
  description: "פרטי החברה ויצירת קשר עבור עובד משרד חכם",
};

export default function CompanyPage() {
  return (
    <main className="container">
      <article className="card mx-auto max-w-4xl">
        <div className="page-kicker">פרטי חברה</div>
        <h1>עובד משרד חכם</h1>
        <p className="mt-3 text-ink-secondary">
          עובד משרד חכם הוא שירות אוטומציה עסקית לעסקים בישראל. השירות עוזר לבעלי עסקים לנהל מיילים עסקיים,
          חשבוניות, ספקים, לקוחות, משימות, מסמכים ודוחות במקום אחד.
        </p>

        <section className="mt-8 grid gap-4 text-ink-secondary">
          <InfoRow label="שם האפליקציה" value="עובד משרד חכם" />
          <InfoRow label="מפעיל השירות" value="Shay Mida" />
          <InfoRow label="אימייל תמיכה" value={<a href="mailto:shaymida337@gmail.com">shaymida337@gmail.com</a>} />
          <InfoRow label="קהל יעד" value="עסקים קטנים ובינוניים בישראל" />
          <InfoRow label="מטרת השירות" value="אוטומציה לניהול משרד, מסמכים, מיילים, תשלומים, לקוחות ומשימות." />
        </section>

        <section className="mt-8 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4 text-ink-secondary">
          <h2>שימוש ב-Google OAuth</h2>
          <p className="mt-3 leading-8">
            המשתמשים מחברים את חשבון Google שלהם רק לאחר אישור מפורש במסך ההרשאות של Google. החיבור מאפשר
            לסרוק מיילים עסקיים בג׳ימייל, ליצור תוויות, לשלוח מיילים שהמשתמש מפעיל, לשמור מסמכים בדרייב
            ולעדכן גיליונות שיטס עבור תהליכי העבודה של העסק.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="btn btn-secondary" href="/privacy-policy">
            מדיניות פרטיות
          </Link>
          <Link className="btn btn-secondary" href="/terms">
            תנאי שימוש
          </Link>
          <Link className="btn btn-secondary" href="/data-deletion">
            מחיקת נתונים
          </Link>
        </div>
      </article>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
      <div className="text-sm font-semibold text-ink-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink-primary">{value}</div>
    </div>
  );
}
