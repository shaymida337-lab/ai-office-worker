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
  BillingConversionHero,
  BillingDayTimeline,
  BillingEmotionalBlock,
  BillingFinalCTA,
  BillingPageShell,
  BillingPrimaryButton,
  BillingSecondaryLink,
  BillingTrustStrip,
} from "@/components/billing/ui";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingPlansPage() {
  const { loading, error, plans, selectedPlanId, setSelectedPlanId, empty, beginCheckout } = useBilling();
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const sortedPlans = [...plans].sort((a, b) => (a.recommended === b.recommended ? 0 : a.recommended ? -1 : 1));

  return (
    <BillingRouteGuard allowedStates={["trial", "trial_ending", "restricted", "cancelled", "past_due", "paused"]}>
      <BillingPageShell>
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && !error && (
          <div className="grid gap-12 md:gap-14">
            <BillingConversionHero />
            <BillingDayTimeline />

            {empty ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-base text-slate-700">
                כרגע לא ניתן להציג אפשרויות. נסה שוב בעוד רגע.
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
                    בחרת ב{getPlanDisplayName(selectedPlan.id)} · ₪{selectedPlan.priceMonthly} לחודש
                  </p>
                )}

                <BillingEmotionalBlock />
                <BillingTrustStrip />
              </>
            )}

            <BillingFinalCTA>
              <BillingPrimaryButton onClick={() => void beginCheckout()}>המשך עם נטלי</BillingPrimaryButton>
              <BillingSecondaryLink href={BILLING_ROUTES["value-report"]}>חזרה לדוח הערך</BillingSecondaryLink>
            </BillingFinalCTA>
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
