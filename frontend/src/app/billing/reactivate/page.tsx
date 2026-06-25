"use client";

import {
  BillingRouteGuard,
  InlineErrorCard,
  LoadingSkeleton,
  PlanCard,
  useBilling,
} from "@/components/billing";
import {
  BillingCTAGroup,
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
          <div className="grid gap-10">
            <BillingHero
              headline="נחזיר את נטלי לעבודה תוך רגע"
              subheadline="בחר מסלול והמשך לחידוש. כל הנתונים שלך כבר שמורים — נטלי תמשיך מאיפה שהפסיקה."
            />

            {empty ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-base text-slate-700">
                אין כרגע נתוני מסלול להצגה. נסה שוב בעוד רגע.
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
                    חידוש עם {selectedPlan.name} · ₪{selectedPlan.priceMonthly} לחודש
                  </p>
                )}

                <BillingTrustStrip />
              </>
            )}

            <BillingCTAGroup
              primary={<BillingPrimaryButton onClick={() => void beginCheckout()}>המשך לחידוש</BillingPrimaryButton>}
              secondary={<BillingSecondaryLink href={BILLING_ROUTES.restricted}>חזרה</BillingSecondaryLink>}
            />
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
