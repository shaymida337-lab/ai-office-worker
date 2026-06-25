"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingTrialEndingPage() {
  const { loading, error, empty, summary } = useBilling();
  return (
    <BillingRouteGuard allowedStates={["trial_ending"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">תקופת הניסיון מסתיימת בקרוב</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          כדי להמשיך בלי הפסקה, כדאי לבחור מסלול לפני סיום הניסיון.
        </p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && empty && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            אין כרגע נתוני תזמון לניסיון. אפשר להמשיך לבחירת מסלול.
          </div>
        )}
        {!loading && !error && !empty && (
          <>
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-bold">סיום ניסיון: {summary.trialEndsAt ? new Date(summary.trialEndsAt).toLocaleString("he-IL") : "לא זמין"}</p>
              <p className="mt-1">אם לא ייבחר מסלול, החשבון יעבור למצב קריאה בלבד.</p>
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={BILLING_ROUTES.plans} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
                בחירת מסלול
              </Link>
              <Link href={BILLING_ROUTES.trial} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
                אחר כך
              </Link>
            </div>
          </>
        )}
      </section>
    </BillingRouteGuard>
  );
}
