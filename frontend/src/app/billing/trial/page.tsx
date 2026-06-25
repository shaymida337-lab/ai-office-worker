"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingTrialPage() {
  const { loading, error, empty, summary } = useBilling();
  return (
    <BillingRouteGuard allowedStates={["trial"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">הניסיון שלך פעיל</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          יש לך גישה מלאה לכל יכולות העבודה המרכזיות. אפשר להמשיך לעבוד כרגיל ולבחור מסלול כשנוח לך.
        </p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && empty && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            אין כרגע נתוני ניסיון להצגה. אפשר להמשיך ישירות לבחירת מסלול.
          </div>
        )}
        {!loading && !error && !empty && (
          <>
            <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <dt className="font-semibold text-slate-700">ימים שנותרו לניסיון</dt>
                <dd className="mt-2 text-xl font-bold text-slate-900">
                  {summary.trialEndsAt
                    ? Math.max(0, Math.ceil((new Date(summary.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                    : 0}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <dt className="font-semibold text-slate-700">תאריך סיום ניסיון</dt>
                <dd className="mt-2 text-lg font-bold text-slate-900">
                  {summary.trialEndsAt ? new Date(summary.trialEndsAt).toLocaleDateString("he-IL") : "לא זמין"}
                </dd>
              </div>
            </dl>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={BILLING_ROUTES["value-report"]} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
                צפייה בדוח הערך האישי
              </Link>
              <Link href={BILLING_ROUTES.plans} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
                השוואת מסלולים
              </Link>
            </div>
          </>
        )}
      </section>
    </BillingRouteGuard>
  );
}
