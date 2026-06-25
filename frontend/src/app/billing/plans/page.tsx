"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, PlanCard, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingPlansPage() {
  const { loading, error, plans, selectedPlanId, setSelectedPlanId, empty, beginCheckout } = useBilling();
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  return (
    <BillingRouteGuard allowedStates={["trial", "trial_ending", "restricted", "cancelled", "past_due", "paused"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">בחירת המסלול המתאים לך</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          שני מסלולים ברורים בלבד, ללא מורכבות מיותרת.
        </p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && empty && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            כרגע לא ניתן להציג מסלולים. נסה שוב בעוד רגע.
          </div>
        )}
        {!loading && !error && !empty && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} selected={selectedPlanId === plan.id} onSelect={setSelectedPlanId} />
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-bold text-slate-900">מסלול נבחר: {selectedPlan?.name}</p>
              <p className="mt-1">חיוב חודשי: ₪{selectedPlan?.priceMonthly}</p>
            </div>
          </>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void beginCheckout()}
            className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white"
          >
            המשך לתשלום
          </button>
          <Link href={BILLING_ROUTES["value-report"]} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            חזרה לדוח הערך
          </Link>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
