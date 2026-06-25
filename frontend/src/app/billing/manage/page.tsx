"use client";

import { useState } from "react";
import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingManagePage() {
  const { loading, error, empty } = useBilling();
  const [confirmType, setConfirmType] = useState<"pause" | "cancel" | null>(null);
  return (
    <BillingRouteGuard allowedStates={["active", "reactivated"]}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">ניהול המנוי</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">אפשר להשהות או לבטל בצורה שקופה. אין ביצוע בפועל בספרינט זה.</p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && empty && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            אין כרגע נתוני מנוי להצגה. נסה לרענן את מצב החשבון.
          </div>
        )}
        {!loading && !error && !empty && (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-lg font-bold text-slate-900">השהיה זמנית</h3>
              <p className="mt-2 text-sm text-slate-600">השהיה לחודש אחד. תאריך כניסה לתוקף: בסוף מחזור החיוב הנוכחי.</p>
              <button onClick={() => setConfirmType("pause")} type="button" className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800">
                השהה מנוי
              </button>
            </article>
            <article className="rounded-xl border border-red-200 bg-red-50 p-5">
              <h3 className="text-lg font-bold text-red-800">ביטול מנוי</h3>
              <p className="mt-2 text-sm text-red-700">הביטול ייכנס לתוקף בסוף התקופה ששולמה מראש.</p>
              <button onClick={() => setConfirmType("cancel")} type="button" className="mt-4 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white">
                בטל מנוי
              </button>
            </article>
          </div>
        )}
        <div className="mt-8">
          <Link href={BILLING_ROUTES.subscription} className="inline-flex rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800">
            חזרה למסך המנוי
          </Link>
        </div>
      </section>

      {confirmType && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-bold text-slate-900">{confirmType === "pause" ? "אישור השהיית מנוי" : "אישור ביטול מנוי"}</h3>
            <p className="mt-3 text-sm text-slate-600">
              {confirmType === "pause"
                ? "בשלב זה זהו מסך דמה. בספרינט הבא יחובר ל-API ניהול מנוי."
                : "בשלב זה זהו מסך דמה. בספרינט הבא יחובר ל-API ביטול מנוי."}
            </p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setConfirmType(null)} className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800">
                סגור
              </button>
              <button type="button" onClick={() => setConfirmType(null)} className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
                הבנתי
              </button>
            </div>
          </div>
        </div>
      )}
    </BillingRouteGuard>
  );
}
