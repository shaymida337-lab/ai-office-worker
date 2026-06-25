"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingValueReportPage() {
  const { loading, error, empty, valueMetrics } = useBilling();
  return (
    <BillingRouteGuard allowedStates={["trial", "trial_ending"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">הערך שכבר קיבלת מ-Natalie</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          הנתונים האלו מסכמים את הערך הפרקטי שקיבלת עד עכשיו כדי לעזור בהחלטת המסלול.
        </p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && empty && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            עדיין אין מספיק נתונים לדוח אישי. אפשר להמשיך לבחירת מסלול ולהתחיל לצבור ערך.
          </div>
        )}
        {!loading && !error && !empty && (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {valueMetrics.map((metric) => (
              <article key={metric.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-600">{metric.label}</p>
                <p className="mt-2 text-2xl font-extrabold text-slate-900">{metric.value}</p>
                <p className="mt-1 text-xs text-slate-500">{metric.helper}</p>
              </article>
            ))}
          </div>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href={BILLING_ROUTES.plans} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
            המשך לבחירת מסלול
          </Link>
          <Link href={BILLING_ROUTES.trial} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
            חזרה
          </Link>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
