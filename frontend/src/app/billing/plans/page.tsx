"use client";

import {
  BillingRouteGuard,
  InlineErrorCard,
  LoadingSkeleton,
  PlanCard,
  useBilling,
} from "@/components/billing";
import { formatPlanPrice, getPlanDisplayName } from "@/components/billing/conversionCopy";
import {
  BillingPlansClosingSection,
  BillingPlansHero,
  BillingPlansReliefSection,
  BillingPlansTrustSection,
  BillingPlansWorkdaySection,
} from "@/components/billing/plans";
import Link from "next/link";

export default function BillingPlansPage() {
  const { loading, error, plans, selectedPlanId, setSelectedPlanId, empty, beginCheckout } = useBilling();
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const sortedPlans = [...plans].sort((a, b) => (a.recommended === b.recommended ? 0 : a.recommended ? -1 : 1));

  const handlePlanChoose = (planId: typeof selectedPlanId) => {
    setSelectedPlanId(planId);
    document.getElementById("closing-cta")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <BillingRouteGuard allowedStates={["trial", "trial_ending", "restricted", "cancelled", "past_due", "paused"]}>
      {loading && (
        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-8">
          <LoadingSkeleton />
        </div>
      )}
      {!!error && <InlineErrorCard message={error} />}

      {!loading && !error && (
        <div className="grid gap-14 md:gap-16 lg:gap-20">
          <BillingPlansHero />
          <BillingPlansReliefSection />
          <BillingPlansWorkdaySection />

          <section id="pricing" className="scroll-mt-24 grid gap-10">
            <div className="grid gap-4 text-right">
              <h2 className="text-2xl font-extrabold text-slate-900 md:text-4xl lg:text-[2.5rem]">
                כמה עבודה אתה רוצה שנטלי תיקח ממך?
              </h2>
              <p className="max-w-2xl text-base leading-8 text-slate-600 md:text-lg">
                אפשר להתחיל מסודר — או לתת לנטלי לקחת יותר אחריות על העבודה המשרדית.
              </p>
            </div>

            {empty ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-base text-slate-700">
                כרגע לא ניתן להציג אפשרויות. נסה שוב בעוד רגע.
              </div>
            ) : (
              <>
                <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-10">
                  {sortedPlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      selected={selectedPlanId === plan.id}
                      onSelect={setSelectedPlanId}
                      onChoose={handlePlanChoose}
                    />
                  ))}
                </div>

                {selectedPlan && (
                  <p className="text-center text-base font-semibold text-slate-600 md:text-lg">
                    בחרתם ב{getPlanDisplayName(selectedPlan.id)} · {formatPlanPrice(selectedPlan.priceMonthly)}
                  </p>
                )}

                <BillingPlansTrustSection />
              </>
            )}
          </section>

          <div id="closing-cta" className="scroll-mt-24">
            <BillingPlansClosingSection>
              <button
                type="button"
                onClick={() => void beginCheckout()}
                className="inline-flex min-h-[3.5rem] w-full items-center justify-center rounded-2xl bg-white px-8 py-4 text-center text-base font-bold text-blue-700 shadow-lg transition hover:bg-blue-50 sm:w-auto md:text-lg"
              >
                התחילו לעבוד עם נטלי
              </button>
              <Link
                href="/dashboard"
                className="inline-flex min-h-[3.5rem] w-full items-center justify-center rounded-2xl border-2 border-white/40 bg-transparent px-8 py-4 text-center text-base font-bold text-white transition hover:bg-white/10 sm:w-auto md:text-lg"
              >
                חזרה ללוח הבקרה
              </Link>
            </BillingPlansClosingSection>
          </div>
        </div>
      )}
    </BillingRouteGuard>
  );
}
