"use client";

import Link from "next/link";
import { InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingIndexPage() {
  const { summary, loading, error, valueMetrics } = useBilling();

  const invoicesHandled = valueMetrics.find((metric) => metric.id === "documents")?.value ?? "0";
  const paymentsFound = valueMetrics.find((metric) => metric.id === "payments")?.value ?? "0";
  const hoursSaved = valueMetrics.find((metric) => metric.id === "hours")?.value ?? "0";

  const isTrial = summary.status === "trial" || summary.status === "trial_ending";
  const isActive = summary.status === "active" || summary.status === "reactivated";
  const isRestricted = summary.status === "restricted" || summary.status === "cancelled" || summary.status === "paused";
  const isPastDue = summary.status === "past_due";

  const daysLeft = summary.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(summary.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 md:p-10">
      {loading && <LoadingSkeleton />}
      {!loading && !!error && <InlineErrorCard message={error} />}

      {!loading && !error && isTrial && (
        <div className="grid gap-8">
          <div className="grid gap-3">
            <h2 className="text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">נטלי כבר התחילה לעבוד בשבילך</h2>
            <p className="text-base font-semibold text-slate-700">נותרו {daysLeft} ימים לניסיון</p>
            <p className="max-w-2xl text-base leading-8 text-slate-700">
              אני כבר מכירה את העסק שלך. אפשר לבחור מסלול כדי שאמשיך לעבוד איתך ללא הפסקה.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-600">חשבוניות שטופלו</p>
              <p className="mt-2 text-3xl font-extrabold text-slate-900">{invoicesHandled}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-600">תשלומים שזוהו</p>
              <p className="mt-2 text-3xl font-extrabold text-slate-900">{paymentsFound}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-600">שעות שנחסכו</p>
              <p className="mt-2 text-3xl font-extrabold text-slate-900">{hoursSaved}</p>
            </article>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={BILLING_ROUTES.plans} className="rounded-xl bg-blue-600 px-6 py-3 text-center text-sm font-bold text-white">
              בחירת מסלול
            </Link>
            <Link href={BILLING_ROUTES["value-report"]} className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-bold text-slate-800">
              צפייה בדוח הערך האישי
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && isActive && (
        <div className="grid gap-8">
          <div className="grid gap-3">
            <h2 className="text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">המנוי שלך פעיל</h2>
            <p className="max-w-2xl text-base leading-8 text-slate-700">
              הכל ממשיך לעבוד בצורה רציפה. כאן אפשר לנהל את המנוי ואת אמצעי התשלום.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-600">מסלול נוכחי</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">{summary.planName ?? "לא זמין"}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-600">חיוב הבא</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">
                {summary.nextBillingAt ? new Date(summary.nextBillingAt).toLocaleDateString("he-IL") : "לא זמין"}
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-600">ערך מאז החיוב האחרון</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">{hoursSaved} שעות</p>
            </article>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={BILLING_ROUTES.manage} className="rounded-xl bg-blue-600 px-6 py-3 text-center text-sm font-bold text-white">
              ניהול המנוי
            </Link>
            <Link href={BILLING_ROUTES["payment-method"]} className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-bold text-slate-800">
              עדכון אמצעי תשלום
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && isRestricted && (
        <div className="grid gap-8">
          <div className="grid gap-3">
            <h2 className="text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">נטלי ממתינה לחזור לעבוד איתך</h2>
            <p className="max-w-2xl text-base leading-8 text-slate-700">
              אפשר להמשיך לצפות בנתונים הקיימים. כדי לחזור לעבודה מלאה צריך להפעיל מנוי מחדש.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-sm font-bold text-emerald-800">זמין כרגע</p>
              <ul className="mt-2 grid gap-1 text-sm text-emerald-800">
                <li>• צפייה בדוחות ובחשבוניות</li>
                <li>• גישה להיסטוריית פעילות</li>
              </ul>
            </article>
            <article className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
              <p className="text-sm font-bold text-amber-900">נעול כרגע</p>
              <ul className="mt-2 grid gap-1 text-sm text-amber-900">
                <li>• יצירה ועריכה של פריטים</li>
                <li>• הפעלת אוטומציות חדשות</li>
              </ul>
            </article>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={BILLING_ROUTES.reactivate} className="rounded-xl bg-blue-600 px-6 py-3 text-center text-sm font-bold text-white">
              הפעלת מנוי מחדש
            </Link>
            <Link href="/dashboard" className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-bold text-slate-800">
              צפייה בנתונים
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && isPastDue && (
        <div className="grid gap-6">
          <h2 className="text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">התשלום האחרון לא הושלם</h2>
          <p className="max-w-2xl text-base leading-8 text-slate-700">אפשר לנסות שוב תשלום או לעדכן אמצעי תשלום כדי לחזור לעבודה מלאה.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={BILLING_ROUTES.failed} className="rounded-xl bg-blue-600 px-6 py-3 text-center text-sm font-bold text-white">
              המשך לטיפול בתשלום
            </Link>
            <Link href={BILLING_ROUTES["payment-method"]} className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-bold text-slate-800">
              עדכון אמצעי תשלום
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
