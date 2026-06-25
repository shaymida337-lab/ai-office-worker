"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingCheckoutPage() {
  const { loading, error, plans, selectedPlanId, beginCheckout } = useBilling();
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? plans[0];
  return (
    <BillingRouteGuard allowedStates={["trial", "trial_ending", "past_due", "cancelled", "restricted", "paused", "reactivated", "active"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">עוד צעד קטן לסיום</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">אישור המסלול והעברה מאובטחת לספק התשלום.</p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-bold text-slate-900">סיכום הזמנה</p>
            <p className="mt-1">מסלול: {selectedPlan?.name ?? "לא נבחר"}</p>
            <p>מחיר חודשי: ₪{selectedPlan?.priceMonthly ?? 0}</p>
          </div>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void beginCheckout()}
            className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white"
          >
            אישור ותשלום
          </button>
          <Link href={BILLING_ROUTES.plans} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            חזרה לבחירת מסלול
          </Link>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
