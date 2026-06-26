import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrustLayout, TrustList, TrustSection } from "@/components/trust";

export const metadata: Metadata = {
  title: "אודות נטלי | נטלי",
  description: "הסיפור של נטלי — עובדת המשרד הדיגיטלית שעוזרת לבעלי עסקים קטנים בישראל",
};

export default function AboutPage() {
  return (
    <PublicTrustLayout kicker="אודות נטלי" title="מי זו נטלי?">
      <TrustSection title="למה נטלי נוצרה">
        <p>
          נטלי נבנתה כדי לעזור לבעלי עסקים קטנים להוריד עבודה משרדית מהראש. לא עוד מערכת מסובכת שדורשת הדרכה
          ארוכה — אלא עובדת משרד דיגיטלית שעוזרת ביום-יום: מסמכים, חשבוניות, תשלומים וסדר בעסק.
        </p>
      </TrustSection>

      <TrustSection title="מה נטלי עושה">
        <TrustList
          items={[
            "קוראת מיילים עסקיים ומזהה מסמכים רלוונטיים.",
            "סורקת חשבוניות וקבלות ומסייעת בניהול תשלומים.",
            "שומרת מסמכים ב-Google Drive לפי ההרשאות שניתנו.",
            "מעדכנת גיליונות Google Sheets לניהול סדר בעסק.",
            "עוזרת במשימות, תזכורות ומעקב אחרי עבודה פתוחה.",
          ]}
        />
      </TrustSection>

      <TrustSection title="המסר המרכזי">
        <p className="rounded-2xl border border-blue-100 bg-blue-50/60 px-5 py-4 text-lg font-bold leading-9 text-slate-900">
          תחזור לנהל את העסק. נטלי תנהל את המשרד.
        </p>
      </TrustSection>

      <TrustSection title="למי זה מתאים">
        <p>
          נטלי מיועדת לעסקים קטנים ובינוניים בישראל שרוצים פחות בלגן משרדי ויותר זמן ללקוחות, למכירות ולצמיחה.
        </p>
        <p>
          מעוניינים להתחיל? <Link href="/signup" className="font-semibold text-blue-700 hover:underline">פתיחת חשבון</Link> או{" "}
          <Link href="/login" className="font-semibold text-blue-700 hover:underline">התחברות</Link>.
        </p>
      </TrustSection>
    </PublicTrustLayout>
  );
}
