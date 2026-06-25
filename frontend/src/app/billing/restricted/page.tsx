"use client";

import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingRestrictedPage() {
  const { loading, error, empty, summary } = useBilling();
  return (
    <BillingRouteGuard allowedStates={["restricted", "paused", "cancelled"]}>
      <section className="rounded-2xl border border-amber-200 bg-white p-6 md:p-8">
        <h2 className="text-2xl font-extrabold text-slate-900">החשבון במצב קריאה בלבד</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          אפשר להמשיך לצפות בכל הנתונים, אבל יצירה ועריכה נעולות עד חידוש המנוי.
        </p>
        {loading && <div className="mt-6"><LoadingSkeleton /></div>}
        {!!error && <div className="mt-6"><InlineErrorCard message={error} /></div>}
        {!loading && !error && empty && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            אין כרגע פירוט הרשאות. מצב הקריאה בלבד עדיין בתוקף.
          </div>
        )}
        {!loading && !error && !empty && (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <h3 className="text-sm font-bold text-emerald-800">מה נשאר זמין</h3>
              <ul className="mt-2 grid gap-1 text-sm text-emerald-700">
                <li>• צפייה בחשבוניות ותשלומים</li>
                <li>• צפייה בדוחות היסטוריים</li>
                <li>• גישה לרשומות קיימות</li>
              </ul>
            </article>
            <article className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <h3 className="text-sm font-bold text-amber-900">מה נעול כרגע</h3>
              <ul className="mt-2 grid gap-1 text-sm text-amber-800">
                <li>• יצירת פריטים חדשים</li>
                <li>• עריכת נתונים קיימים</li>
                <li>• פעולות אוטומציה חדשות</li>
              </ul>
            </article>
          </div>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href={BILLING_ROUTES.reactivate} className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white">
            הפעלת מנוי מחדש
          </Link>
          <span className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-bold text-slate-700">
            מצב נוכחי: {summary.status}
          </span>
        </div>
      </section>
    </BillingRouteGuard>
  );
}
