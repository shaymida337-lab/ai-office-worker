"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingSuccessPage() {
  const { loading, error, summary, refresh } = useBilling();

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      for (let i = 0; i < 6 && mounted; i += 1) {
        await refresh();
        if (summary.status === "active" || summary.status === "reactivated") break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [refresh, summary.status]);

  return (
    <BillingRouteGuard allowedStates={["active", "reactivated", "trial", "trial_ending", "past_due"]}>
      <section className="rounded-2xl border border-emerald-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">התשלום התקבל</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">אנחנו מאמתים את מצב המנוי מול השרת. זה עשוי לקחת כמה שניות.</p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            סטטוס נוכחי: {summary.status}
          </div>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href={BILLING_ROUTES.subscription} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
            מעבר לניהול המנוי
          </Link>
          <Link href="/dashboard" className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            חזרה לדשבורד
          </Link>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
