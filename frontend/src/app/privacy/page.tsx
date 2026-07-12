import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrustLayout, TrustList, TrustSection } from "@/components/trust";
import { TRUST_LAST_UPDATED, TRUST_SUPPORT_EMAIL } from "@/lib/trust/constants";

export const metadata: Metadata = {
  title: "מדיניות פרטיות",
  description: "מדיניות הפרטיות של נטלי — עובדת המשרד הדיגיטלית לעסקים בישראל",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PublicTrustLayout kicker="מדיניות פרטיות" title="איך נטלי מטפלת במידע שלך" updatedAt={TRUST_LAST_UPDATED}>
      <TrustSection title="איזה מידע אנחנו אוספים">
        <p>נטלי אוספת ומעבדת מידע רק כדי להפעיל את השירות שהמשתמש ביקש. בין היתר:</p>
        <TrustList
          items={[
            "פרטי חשבון: שם, כתובת אימייל ומזהה משתמש.",
            "נתונים עסקיים שהמשתמש מזין או שהמערכת מפיקה: לקוחות, ספקים, משימות, תשלומים, חשבוניות וסטטוסים.",
            "תוכן מיילים ומסמכים שהמשתמש מאשר לגשת אליהם דרך Google, לצורך זיהוי חשבוניות, קבלות, ספקים, סכומים ותשלומים.",
            "קבצים ונתונים ב-Google Drive וב-Google Sheets שנוצרים או מתעדכנים במסגרת השירות.",
            "מטא-נתונים טכניים הנדרשים להפעלה, אבטחה ותמיכה.",
          ]}
        />
      </TrustSection>

      <TrustSection title="למה נטלי צריכה גישה ל-Gmail / Google Drive / Google Sheets">
        <p>נטלי משתמשת בהרשאות Google כדי לבצע פעולות שהמשתמש מבקש — לא מעבר לכך.</p>
        <TrustList
          items={[
            "Gmail — לקרוא מיילים עסקיים, לזהות מסמכים רלוונטיים ולסייע בניהול תהליכי עבודה.",
            "Google Drive — לשמור מסמכים בתיקיות שהמשתמש מאשר, לפי ההרשאות שניתנו.",
            "Google Sheets — לעדכן גיליונות עבור תשלומים, משימות ודוחות שהמשתמש בוחר להפעיל.",
          ]}
        />
        <p>נטלי לא שומרת סיסמת Gmail. ההתחברות מתבצעת באמצעות OAuth של Google.</p>
      </TrustSection>

      <TrustSection title="איך אנחנו משתמשים במידע">
        <TrustList
          items={[
            "להציג מידע עסקי בדשבורד ובתהליכי העבודה של המשתמש.",
            "לזהות חשבוניות, קבלות, ספקים, סכומים ותשלומים מתוך מיילים ומסמכים.",
            "לשמור ולארגן מסמכים ב-Google Drive לפי ההרשאות שניתנו.",
            "לעדכן גיליונות Google Sheets עבור ניהול תשלומים ומשימות.",
            "לספק תמיכה, לשפר את השירות ולשמור על אבטחה ותקינות תפעולית.",
          ]}
        />
      </TrustSection>

      <TrustSection title="שימוש בבינה מלאכותית לעיבוד מסמכים">
        <p>
          חלק מהמידע מעובד באמצעות כלי בינה מלאכותית כדי לזהות חשבוניות, קבלות, ספקים, סכומים ותשלומים. התוצרים
          מוצגים למשתמש לבדיקה ואישור. ייתכנו טעויות בזיהוי — המשתמש אחראי לבדוק מידע פיננסי לפני קבלת החלטות.
        </p>
        <p>איננו משתמשים בנתוני Google לאימון מודלים כלליים או למטרות פרסום.</p>
      </TrustSection>

      <TrustSection title="שיתוף מידע עם צדדים שלישיים">
        <p>המידע לא נמכר לצדדים שלישיים.</p>
        <p>
          מידע עשוי להיות מעובד אצל ספקי תשתית הדרושים להפעלת השירות — כגון אירוח, מסד נתונים, שירותי AI ו-API —
          ורק במידה הנדרשת להפעלת השירות ובכפוף להתחייבויות סודיות ואבטחה.
        </p>
        <p>
          השימוש בנתוני Google כפוף גם ל-
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="font-semibold text-blue-700 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , כולל דרישות Limited Use.
        </p>
      </TrustSection>

      <TrustSection title="שמירה ואבטחת מידע">
        <p>
          אנו שומרים מידע כל עוד החשבון פעיל או כל עוד הוא נחוץ להפעלת השירות. נעשה שימוש באמצעי אבטחה סבירים,
          כולל הגנה על אסימוני גישה והגבלת גישה למידע לפי צורך תפעולי.
        </p>
        <p>למידע נוסף על אבטחה, ראו את עמוד <Link href="/security" className="font-semibold text-blue-700 hover:underline">האבטחה</Link>.</p>
      </TrustSection>

      <TrustSection title="ניתוק הרשאות Google">
        <p>אפשר לנתק גישה בכל רגע — דרך הגדרות השירות או דרך חשבון Google של המשתמש (הרשאות אפליקציות מחוברות).</p>
        <p>לאחר ניתוק, נטלי לא תוכל לגשת למידע חדש מ-Google, אך מידע שכבר נשמר במערכת או ב-Drive עשוי להישאר עד לבקשת מחיקה.</p>
      </TrustSection>

      <TrustSection title="מחיקת מידע">
        <p>המשתמש יכול לפנות למחיקת מידע וחשבון. נטפל בבקשות בהתאם לדין החל וליכולת התפעולית של השירות.</p>
        <p>
          הוראות נוספות זמינות בעמוד <Link href="/data-deletion" className="font-semibold text-blue-700 hover:underline">מחיקת נתונים</Link>.
        </p>
      </TrustSection>

      <TrustSection title="יצירת קשר">
        <p>
          לשאלות בנוגע לפרטיות או למחיקת מידע:{" "}
          <a href={`mailto:${TRUST_SUPPORT_EMAIL}`} className="font-semibold text-blue-700 hover:underline">
            {TRUST_SUPPORT_EMAIL}
          </a>
        </p>
        <p>
          ניתן גם לפנות דרך <Link href="/contact" className="font-semibold text-blue-700 hover:underline">עמוד יצירת הקשר</Link>.
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
