"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingPaymentMethodPage() {
  const { loading, error, beginPaymentMethodUpdate, refresh } = useBilling();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("updated") === "1") {
      void refresh();
    }
  }, [refresh, searchParams]);

  return (
    <BillingRouteGuard allowedStates={["active", "past_due", "reactivated", "restricted", "cancelled", "paused"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">עדכון אמצעי תשלום</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">העדכון מתבצע בצורה מאובטחת דרך ספק התשלומים.</p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {searchParams.get("updated") === "1" && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            אמצעי התשלום עודכן בהצלחה.
          </div>
        )}
        {searchParams.get("cancelled") === "1" && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            עדכון אמצעי תשלום בוטל.
          </div>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => void beginPaymentMethodUpdate()} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
            עדכון אמצעי תשלום מאובטח
          </button>
          <Link href={BILLING_ROUTES.subscription} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            חזרה למנוי
          </Link>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
