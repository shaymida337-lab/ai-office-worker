"use client";

import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { getPlanDisplayName, PLANS_TRUST_ITEMS } from "@/components/billing/conversionCopy";
import { BillingPageShell, BillingPrimaryButton, BillingSecondaryLink } from "@/components/billing/ui";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingCheckoutPage() {
  const { loading, error, plans, selectedPlanId, beginCheckout } = useBilling();
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? plans[0];

  return (
    <BillingRouteGuard allowedStates={["trial", "trial_ending", "past_due", "cancelled", "restricted", "paused", "reactivated", "active"]}>
      <BillingPageShell>
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && (
          <div className="grid gap-10">
            <div className="grid gap-4 text-right">
              <h2 className="text-2xl font-extrabold text-slate-900 md:text-4xl">נשאר רק לאשר שנטלי ממשיכה לעבוד איתך</h2>
              <p className="text-base leading-8 text-slate-600 md:text-lg">
                אחרי האישור, נטלי תמשיך לעבוד עם העסק שלך ללא הפסקה.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-base text-slate-700">
              <p className="font-bold text-slate-900">{getPlanDisplayName(selectedPlan?.id ?? null)}</p>
              <p className="mt-2">₪{selectedPlan?.priceMonthly ?? 0} לחודש · בלי התחייבות</p>
            </div>

            <section className="grid gap-4">
              <h3 className="text-xl font-extrabold text-slate-900">אפשר לסמוך על נטלי</h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {PLANS_TRUST_ITEMS.map((item) => (
                  <li key={item.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 md:text-base">
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="flex flex-col gap-3 sm:flex-row">
              <BillingPrimaryButton onClick={() => void beginCheckout()}>אישור והמשך עבודה עם נטלי</BillingPrimaryButton>
              <BillingSecondaryLink href={BILLING_ROUTES.plans}>חזרה</BillingSecondaryLink>
            </div>
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
