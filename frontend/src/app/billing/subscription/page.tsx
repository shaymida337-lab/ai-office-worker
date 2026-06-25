"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingSubscriptionPage() {
  const { loading, error, summary, billingHistory, empty } = useBilling();
  return (
    <BillingRouteGuard allowedStates={["active", "reactivated"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">המנוי שלך פעיל</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">הכל עובד כרגיל. אפשר לעדכן אמצעי תשלום או לנהל את המנוי.</p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && (
          <>
            <div className="mt-6 grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-600">מסלול</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{summary.planName ?? "לא זמין"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-600">מצב נוכחי</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{summary.status}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-600">חיוב הבא</p>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  {summary.nextBillingAt ? new Date(summary.nextBillingAt).toLocaleDateString("he-IL") : "לא זמין"}
                </p>
              </div>
            </div>
            <div className="mt-6">
              <h3 className="text-sm font-bold text-slate-700">היסטוריית חיובים</h3>
              {empty || billingHistory.length === 0 ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  אין כרגע היסטוריית חיובים להצגה.
                </div>
              ) : (
                <ul className="mt-3 grid gap-2">
                  {billingHistory.map((item) => (
                    <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{item.description}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {item.status === "paid" ? "שולם" : "בהמתנה"}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-600">₪{item.amount} · {new Date(item.date).toLocaleDateString("he-IL")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={BILLING_ROUTES["payment-method"]} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
                עדכון אמצעי תשלום
              </Link>
              <Link href={BILLING_ROUTES.manage} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-800">
                ניהול מנוי
              </Link>
            </div>
          </>
        )}
      </section>
    </BillingRouteGuard>
  );
}
