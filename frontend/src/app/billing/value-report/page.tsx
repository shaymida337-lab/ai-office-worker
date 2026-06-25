"use client";

import {
  BillingRouteGuard,
  InlineErrorCard,
  LoadingSkeleton,
  useBilling,
} from "@/components/billing";
import {
  BillingCTAGroup,
  BillingHero,
  BillingPageShell,
  BillingPrimaryLink,
  BillingSecondaryLink,
  BillingValueCard,
} from "@/components/billing/ui";
import { BILLING_ROUTES } from "@/lib/billing/model";

const REPORT_CARDS = [
  { id: "documents", label: "קראתי וסידרתי מסמכים", accent: "blue" as const, icon: "📄" },
  { id: "payments", label: "זיהיתי תשלומים", accent: "indigo" as const, icon: "💳" },
  { id: "hours", label: "חסכתי לך זמן", accent: "violet" as const, icon: "⏱️" },
  { id: "tasks", label: "הכנתי את העסק להמשך עבודה מסודרת", accent: "emerald" as const, icon: "✨" },
] as const;

export default function BillingValueReportPage() {
  const { loading, error, empty, valueMetrics } = useBilling();

  const metricValue = (id: string) => valueMetrics.find((metric) => metric.id === id)?.value ?? "—";

  return (
    <BillingRouteGuard allowedStates={["trial", "trial_ending"]}>
      <BillingPageShell>
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && !error && (
          <div className="grid gap-10">
            <BillingHero
              headline="זה מה שנטלי כבר עשתה בשבילך"
              subheadline="בזמן הניסיון נטלי התחילה להוריד ממך עבודה משרדית אמיתית."
            />

            {empty ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-base leading-8 text-slate-700">
                עדיין אין מספיק נתונים לדוח אישי — אבל נטלי ממשיכה לעבוד. אפשר להמשיך ולתת לה להמשיך מאיפה שהפסיקה.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {REPORT_CARDS.map((card) => (
                  <BillingValueCard
                    key={card.id}
                    label={card.label}
                    value={metricValue(card.id)}
                    accent={card.accent}
                    icon={card.icon}
                  />
                ))}
              </div>
            )}

            <p className="text-center text-lg font-semibold leading-9 text-slate-700 md:text-xl">
              זו רק ההתחלה. ככל שנטלי עובדת יותר, היא מכירה את העסק שלך טוב יותר.
            </p>

            <BillingCTAGroup
              primary={<BillingPrimaryLink href={BILLING_ROUTES.plans}>כמה עבודה להוריד מהכתפיים?</BillingPrimaryLink>}
              secondary={<BillingSecondaryLink href="/billing">חזרה</BillingSecondaryLink>}
            />
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
