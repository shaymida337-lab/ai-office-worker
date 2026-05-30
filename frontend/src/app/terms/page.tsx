import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "תנאי שימוש | עובד משרד חכם",
  description: "תנאי השימוש של עובד משרד חכם",
};

export default function TermsPage() {
  return (
    <main className="container">
      <article className="card mx-auto max-w-4xl">
        <div className="page-kicker">תנאי שימוש</div>
        <h1>תנאי שימוש - עובד משרד חכם</h1>
        <p className="mt-3 text-sm text-ink-muted">עודכן לאחרונה: מאי 2026</p>

        <section className="mt-8 grid gap-6 text-ink-secondary">
          <LegalSection title="קבלת התנאים">
            <p>
              השימוש בעובד משרד חכם כפוף לתנאים אלה. אם אינך מסכים לתנאים, אין להשתמש בשירות.
            </p>
          </LegalSection>

          <LegalSection title="תיאור השירות">
            <p>
              עובד משרד חכם הוא שירות אוטומציה עסקית שמסייע בניהול מיילים עסקיים, חשבוניות, מסמכי ספקים, לקוחות,
              משימות, גבייה, דוחות ותקשורת עסקית. השירות עשוי להשתמש בחשבון Google של המשתמש, לאחר אישור מפורש,
              כדי לקרוא מיילים, ליצור תוויות, לשלוח מיילים, לשמור קבצים בדרייב ולעדכן גיליונות שיטס.
            </p>
            <p className="mt-3">
              מפעיל השירות: Shay Mida. ליצירת קשר:{" "}
              <a href="mailto:shaymida337@gmail.com">shaymida337@gmail.com</a>.
            </p>
          </LegalSection>

          <LegalSection title="אחריות המשתמש">
            <ul className="list-inside list-disc space-y-2">
              <li>לספק מידע נכון ומעודכן.</li>
              <li>לבדוק מידע פיננסי, חשבוניות ותשלומים לפני קבלת החלטות עסקיות.</li>
              <li>לא להשתמש בשירות לפעילות בלתי חוקית, פוגענית או מפרה זכויות.</li>
              <li>לשמור על אבטחת חשבון המשתמש וחשבון Google המחובר.</li>
            </ul>
          </LegalSection>

          <LegalSection title="הרשאות Google">
            <p>
              השירות מבקש הרשאות Google רק כדי להפעיל את יכולות המוצר: סריקת מיילים עסקיים, יצירת תוויות,
              שליחת מיילים שהמשתמש מפעיל, שמירת קבצים בדרייב ועדכון גיליונות שיטס. ניתן לנתק את הגישה בכל עת
              דרך הגדרות השירות או דרך חשבון Google.
            </p>
            <p className="mt-3">
              השימוש בנתוני Google כפוף גם למדיניות הפרטיות שלנו ולדרישות Google API Services User Data Policy,
              כולל Limited Use.
            </p>
          </LegalSection>

          <LegalSection title="דיוק מידע ואוטומציה">
            <p>
              השירות כולל ניתוח אוטומטי של מידע עסקי. ייתכנו טעויות בזיהוי מסמכים, סכומים, תאריכים או סטטוסים.
              המשתמש אחראי לבדוק תוצרים לפני שימוש חשבונאי, משפטי או פיננסי.
            </p>
          </LegalSection>

          <LegalSection title="הגבלת אחריות">
            <p>
              השירות מסופק כפי שהוא. ככל שמותר לפי דין, לא נהיה אחראים לנזקים עקיפים, אובדן רווחים, אובדן נתונים,
              טעויות עסקיות או הסתמכות על מידע אוטומטי ללא בדיקה.
            </p>
          </LegalSection>

          <LegalSection title="הפסקת שימוש ומחיקת נתונים">
            <p>
              ניתן להפסיק שימוש בשירות בכל עת. למחיקת חשבון או נתונים ניתן לפנות אלינו בכתובת התמיכה. ניתוק
              הרשאות Google אפשרי גם דרך חשבון Google של המשתמש.
            </p>
          </LegalSection>

          <LegalSection title="שינויים בתנאים">
            <p>
              אנו עשויים לעדכן תנאים אלה מעת לעת. המשך שימוש בשירות לאחר עדכון התנאים מהווה הסכמה לתנאים המעודכנים.
            </p>
          </LegalSection>

          <LegalSection title="יצירת קשר">
            <p>
              לשאלות בנוגע לתנאי השימוש: <a href="mailto:shaymida337@gmail.com">shaymida337@gmail.com</a>
            </p>
          </LegalSection>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="btn btn-secondary" href="/">
            חזרה לדף הבית
          </Link>
          <Link className="btn btn-secondary" href="/privacy-policy">
            מדיניות פרטיות
          </Link>
          <Link className="btn btn-secondary" href="/data-deletion">
            מחיקת נתונים
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
