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
          <div className="grid gap-10">
            <BillingHero
              headline="בחר את הדרך שבה נטלי תעבוד איתך"
              subheadline="שני מסלולים פשוטים. בלי התחייבות. אפשר לשנות או לבטל בכל רגע."
            />

            {empty ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-base text-slate-700">
                כרגע לא ניתן להציג מסלולים. נסה שוב בעוד רגע.
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
                    בחרת ב־{selectedPlan.name} · ₪{selectedPlan.priceMonthly} לחודש
                  </p>
                )}

                <BillingTrustStrip />
              </>
            )}

            <BillingCTAGroup
              primary={<BillingPrimaryButton onClick={() => void beginCheckout()}>המשך לתשלום</BillingPrimaryButton>}
              secondary={<BillingSecondaryLink href={BILLING_ROUTES["value-report"]}>חזרה לדוח הערך</BillingSecondaryLink>}
            />
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
