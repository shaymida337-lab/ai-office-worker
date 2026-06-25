"use client";

import {
  BillingRouteGuard,
  InlineErrorCard,
  LoadingSkeleton,
  PlanCard,
  useBilling,
} from "@/components/billing";
import { getPlanDisplayName } from "@/components/billing/conversionCopy";
import {
  BillingEmotionalBlock,
  BillingFinalCTA,
  BillingHero,
  BillingPageShell,
  BillingPrimaryButton,
  BillingSecondaryLink,
  BillingTrustStrip,
} from "@/components/billing/ui";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingReactivatePage() {
  const { loading, error, empty, plans, selectedPlanId, setSelectedPlanId, beginCheckout } = useBilling();
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const sortedPlans = [...plans].sort((a, b) => (a.recommended === b.recommended ? 0 : a.recommended ? -1 : 1));

  return (
    <BillingRouteGuard allowedStates={["restricted", "paused", "cancelled", "past_due"]}>
      <BillingPageShell>
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && !error && (
          <div className="grid gap-12">
            <BillingHero
              showPortrait
              headline="נחזיר את נטלי לעבודה תוך רגע"
              subheadline="כל הנתונים שלך שמורים. נטלי תמשיך בדיוק מאיפה שהפסיקה — רק צריך להחליט כמה עבודה היא תיקח מהכתפיים שלך."
            />

            {empty ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-base text-slate-700">
                אין כרגע אפשרויות להצגה. נסה שוב בעוד רגע.
              </div>
            ) : (
              <>
                <div className="grid items-stretch gap-6 md:grid-cols-2 md:gap-8">
                  {sortedPlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      selected={selectedPlanId === plan.id}
                      onSelect={setSelectedPlanId}
                    />
                  ))}
                </div>

                {selectedPlan && (
                  <p className="text-center text-base font-semibold text-slate-600">
                    חידוש עם {getPlanDisplayName(selectedPlan.id)} · ₪{selectedPlan.priceMonthly} לחודש
                  </p>
                )}

                <BillingEmotionalBlock />
                <BillingTrustStrip />
              </>
            )}

            <BillingFinalCTA headline="מוכן להחזיר את נטלי לעבודה?">
              <BillingPrimaryButton onClick={() => void beginCheckout()}>המשך לחידוש</BillingPrimaryButton>
              <BillingSecondaryLink href={BILLING_ROUTES.restricted}>חזרה</BillingSecondaryLink>
            </BillingFinalCTA>
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
