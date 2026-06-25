"use client";

import {
  InlineErrorCard,
  LoadingSkeleton,
  useBilling,
} from "@/components/billing";
import {
  BillingAccessPanels,
  BillingCTAGroup,
  BillingHero,
  BillingHighlightQuote,
  BillingPageShell,
  BillingPrimaryLink,
  BillingSecondaryLink,
  BillingValueCard,
} from "@/components/billing/ui";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingIndexPage() {
  const { summary, loading, error, valueMetrics } = useBilling();

  const documents = valueMetrics.find((metric) => metric.id === "documents")?.value ?? "0";
  const payments = valueMetrics.find((metric) => metric.id === "payments")?.value ?? "0";
  const hours = valueMetrics.find((metric) => metric.id === "hours")?.value ?? "0";

  const isTrial = summary.status === "trial" || summary.status === "trial_ending";
  const isActive = summary.status === "active" || summary.status === "reactivated";
  const isRestricted = summary.status === "restricted" || summary.status === "cancelled" || summary.status === "paused";
  const isPastDue = summary.status === "past_due";

  const daysLeft = summary.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(summary.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <BillingPageShell>
      {loading && <LoadingSkeleton />}
      {!loading && !!error && <InlineErrorCard message={error} />}

      {!loading && !error && isTrial && (
        <div className="grid gap-10">
          <BillingHero
            showPortrait
            badge={`נותרו ${daysLeft} ימים לניסיון`}
            headline="נטלי כבר התחילה לעבוד בשבילך"
            subheadline="בזמן תקופת הניסיון נטלי כבר סידרה מסמכים, זיהתה תשלומים וחסכה לך שעות עבודה. עכשיו אפשר לבחור מסלול כדי שהיא תמשיך לעבוד איתך ללא הפסקה."
          />

          <div className="grid gap-4 md:grid-cols-3">
            <BillingValueCard label="מסמכים שטופלו" value={documents} accent="blue" icon="📄" />
            <BillingValueCard label="תשלומים שזוהו" value={payments} accent="indigo" icon="💳" />
            <BillingValueCard label="שעות שנחסכו" value={hours} accent="violet" icon="⏱️" />
          </div>

          <BillingHighlightQuote>
            אני כבר מכירה את העסק שלך. אם תרצה, אני יכולה להמשיך בדיוק מאיפה שהפסקנו.
          </BillingHighlightQuote>

          <BillingCTAGroup
            primary={<BillingPrimaryLink href={BILLING_ROUTES.plans}>בחירת מסלול</BillingPrimaryLink>}
            secondary={<BillingSecondaryLink href={BILLING_ROUTES["value-report"]}>צפייה בדוח הערך האישי</BillingSecondaryLink>}
          />
        </div>
      )}

      {!loading && !error && isActive && (
        <div className="grid gap-10">
          <BillingHero
            headline="המנוי שלך פעיל"
            subheadline="נטלי ממשיכה לעבוד איתך כרגיל. הכל מסודר — אפשר לנהל את המנוי ואת אמצעי התשלום בקלות."
          />

          <div className="grid gap-4 md:grid-cols-3">
            <BillingValueCard label="מסלול נוכחי" value={summary.planName ?? "—"} accent="emerald" />
            <BillingValueCard
              label="חיוב הבא"
              value={summary.nextBillingAt ? new Date(summary.nextBillingAt).toLocaleDateString("he-IL") : "—"}
              accent="blue"
            />
            <BillingValueCard label="שעות שנחסכו מאז החיוב האחרון" value={hours} accent="violet" />
          </div>

          <BillingCTAGroup
            primary={<BillingPrimaryLink href={BILLING_ROUTES.manage}>ניהול המנוי</BillingPrimaryLink>}
            secondary={<BillingSecondaryLink href={BILLING_ROUTES["payment-method"]}>עדכון אמצעי תשלום</BillingSecondaryLink>}
          />
        </div>
      )}

      {!loading && !error && isRestricted && (
        <div className="grid gap-10">
          <BillingHero
            headline="נטלי ממתינה לחזור לעבוד איתך"
            subheadline="המידע שלך שמור. אפשר לצפות בנתונים קיימים, וכשתרצה להחזיר את נטלי לעבודה — זה ייקח רגע."
          />

          <BillingAccessPanels
            availableItems={["צפייה בדוחות ובחשבוניות", "גישה להיסטוריית פעילות", "כל הנתונים שכבר נאספו"]}
            lockedItems={["יצירה ועריכה של פריטים חדשים", "הפעלת אוטומציות חדשות", "עבודה שוטפת עם נטלי"]}
          />

          <BillingCTAGroup
            primary={<BillingPrimaryLink href={BILLING_ROUTES.reactivate}>הפעלת מנוי מחדש</BillingPrimaryLink>}
            secondary={<BillingSecondaryLink href="/dashboard">צפייה בנתונים</BillingSecondaryLink>}
          />
        </div>
      )}

      {!loading && !error && isPastDue && (
        <div className="grid gap-8">
          <BillingHero
            headline="התשלום האחרון לא הושלם"
            subheadline="אפשר לנסות שוב תשלום או לעדכן אמצעי תשלום כדי שנטלי תמשיך לעבוד איתך ללא הפרעה."
          />
          <BillingCTAGroup
            primary={<BillingPrimaryLink href={BILLING_ROUTES.failed}>המשך לטיפול בתשלום</BillingPrimaryLink>}
            secondary={<BillingSecondaryLink href={BILLING_ROUTES["payment-method"]}>עדכון אמצעי תשלום</BillingSecondaryLink>}
          />
        </div>
      )}
    </BillingPageShell>
  );
}
