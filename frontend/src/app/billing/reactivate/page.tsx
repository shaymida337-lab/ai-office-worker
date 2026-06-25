"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, PlanCard, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingReactivatePage() {
  const { loading, error, empty, plans, selectedPlanId, setSelectedPlanId } = useBilling();
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  return (
    <BillingRouteGuard allowedStates={["restricted", "paused", "cancelled", "past_due"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">נחזיר אותך לפעילות תוך רגע</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">בחר מסלול, בדוק את הסיכום, והמשך לשלב התשלום (בשלב הבא).</p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && empty && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            אין כרגע נתוני מסלול להצגה.
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
              <p className="font-bold text-slate-900">סיכום חידוש</p>
              <p className="mt-1">מסלול: {selectedPlan?.name}</p>
              <p>מחיר חודשי: ₪{selectedPlan?.priceMonthly}</p>
              <p>סטטוס תשלום: מוכן לחיבור בספרינט הבא</p>
            </div>
          </>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href={BILLING_ROUTES.checkout} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
            המשך לתשלום וחידוש
          </Link>
          <Link href={BILLING_ROUTES.restricted} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            חזרה לקריאה בלבד
          </Link>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
