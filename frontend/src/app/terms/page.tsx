import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrustLayout, TrustList, TrustSection } from "@/components/trust";
import { TRUST_LAST_UPDATED, TRUST_SUPPORT_EMAIL } from "@/lib/trust/constants";

export const metadata: Metadata = {
  title: "תנאי שימוש",
  description: "תנאי השימוש של נטלי — עובדת המשרד הדיגיטלית לעסקים בישראל",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PublicTrustLayout kicker="תנאי שימוש" title="תנאי השימוש בנטלי" updatedAt={TRUST_LAST_UPDATED}>
      <TrustSection title="קבלת תנאי השימוש">
        <p>
          השימוש בנטלי כפוף לתנאים אלה. בכניסה לשירות, בפתיחת חשבון או בהמשך שימוש — המשתמש מאשר שקרא והבין את
          התנאים. אם אינך מסכים, אין להשתמש בשירות.
        </p>
      </TrustSection>

      <TrustSection title="מה נטלי עושה">
        <p>
          נטלי היא עובדת משרד דיגיטלית שעוזרת לבעלי עסקים קטנים בניהול עבודה משרדית: מסמכים, חשבוניות, תשלומים,
          משימות וסדר בעסק. השירות עשוי לכלול חיבור לחשבון Google של המשתמש — לאחר אישור מפורש — לקריאת מיילים,
          שמירת מסמכים ב-Drive ועדכון גיליונות Sheets.
        </p>
        <p className="font-semibold text-slate-800">תחזור לנהל את העסק. נטלי תנהל את המשרד.</p>
      </TrustSection>

      <TrustSection title="אחריות המשתמש">
        <TrustList
          items={[
            "לספק מידע נכון ומעודכן.",
            "לבדוק מידע פיננסי, חשבוניות ותשלומים לפני קבלת החלטות עסקיות.",
            "לשמור על אבטחת חשבון המשתמש וחשבון Google המחובר.",
            "להשתמש בשירות בהתאם לדין החל.",
          ]}
        />
      </TrustSection>

      <TrustSection title="שימוש מותר ואסור">
        <p>שימוש מותר: ניהול עבודה משרדית עסקית לגיטימית באמצעות הכלים שהשירות מספק.</p>
        <TrustList
          items={[
            "אסור להשתמש בשירות לפעילות בלתי חוקית, פוגענית או מפרה זכויות.",
            "אסור לנסות לעקוף מנגנוני אבטחה, לפגוע בשירות או בצדדים שלישיים.",
            "אסור להעביר גישה לחשבון ללא הרשאה מתאימה.",
          ]}
        />
      </TrustSection>

      <TrustSection title="תשלומים ומנויים">
        <p>
          חלק מהשירותים עשויים להיות כרוכים בתשלום חודשי או בתקופת ניסיון, כפי שמוצג בעת ההרשמה או בעמודי החיוב.
          המחירים, התכונות והתנאים המסחריים עשויים להשתנות — והגרסה המעודכנת תוצג למשתמש לפני חיוב.
        </p>
      </TrustSection>

      <TrustSection title="ביטול מנוי">
        <p>
          ניתן לבטל מנוי בהתאם לאפשרויות שמוצגות בממשק החיוב או בפנייה לתמיכה. ביטול עשוי להיכנס לתוקף בתחילת
          מחזור החיוב הבא, בהתאם למדיניות התשלום הרלוונטית.
        </p>
      </TrustSection>

      <TrustSection title="זמינות השירות">
        <p>
          אנו שואפים לספק שירות יציב וזמין, אך ייתכנו תקלות, עדכונים או השבתות זמניות. השירות מסופק ללא התחייבות
          לזמינות רציפה או ללא הפרעות.
        </p>
      </TrustSection>

      <TrustSection title="הגבלת אחריות">
        <p>
          השירות כולל ניתוח אוטומטי ועיבוד מסמכים — ייתכנו טעויות. השירות מסופק &quot;כפי שהוא&quot;. ככל שמותר
          לפי דין, לא נהיה אחראים לנזקים עקיפים, אובדן רווחים, אובדן נתונים או הסתמכות על מידע אוטומטי ללא בדיקה.
        </p>
      </TrustSection>

      <TrustSection title="שינויים בתנאים">
        <p>
          אנו עשויים לעדכן תנאים אלה מעת לעת. המשך שימוש בשירות לאחר עדכון מהווה הסכמה לתנאים המעודכנים. שינויים
          מהותיים יוצגו למשתמשים בדרך סבירה.
        </p>
      </TrustSection>

      <TrustSection title="יצירת קשר">
        <p>
          לשאלות בנוגע לתנאי השימוש:{" "}
          <a href={`mailto:${TRUST_SUPPORT_EMAIL}`} className="font-semibold text-blue-700 hover:underline">
            {TRUST_SUPPORT_EMAIL}
          </a>
        </p>
        <p>
          ראו גם <Link href="/privacy" className="font-semibold text-blue-700 hover:underline">מדיניות הפרטיות</Link> ו-
          <Link href="/contact" className="font-semibold text-blue-700 hover:underline">יצירת קשר</Link>.
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
