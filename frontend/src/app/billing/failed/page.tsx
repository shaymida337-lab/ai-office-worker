"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingFailedPage() {
  const { loading, error, beginCheckout } = useBilling();
  return (
    <BillingRouteGuard allowedStates={["past_due", "trial", "trial_ending", "restricted", "cancelled", "paused"]}>
      <section className="rounded-2xl border border-red-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">התשלום לא הושלם</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">אפשר לנסות שוב, לעדכן אמצעי תשלום או לבחור מסלול מחדש.</p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => void beginCheckout()} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
            נסה שוב
          </button>
          <Link href={BILLING_ROUTES["payment-method"]} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            עדכון אמצעי תשלום
          </Link>
          <Link href={BILLING_ROUTES.plans} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            חזרה למסלולים
          </Link>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
