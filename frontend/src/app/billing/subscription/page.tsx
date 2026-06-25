"use client";

import {
  BillingRouteGuard,
  InlineErrorCard,
  LoadingSkeleton,
  useBilling,
} from "@/components/billing";
import {
  BillingCTAGroup,
  BillingHero,
  BillingPageShell,
  BillingPrimaryLink,
  BillingSecondaryLink,
  BillingValueCard,
} from "@/components/billing/ui";
import { getPlanDisplayName } from "@/components/billing/conversionCopy";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingSubscriptionPage() {
  const { loading, error, summary, billingHistory, empty, valueMetrics } = useBilling();

  const hours = valueMetrics.find((metric) => metric.id === "hours")?.value ?? "0";
  const documents = valueMetrics.find((metric) => metric.id === "documents")?.value ?? "0";
  const payments = valueMetrics.find((metric) => metric.id === "payments")?.value ?? "0";

  const recentHistory = billingHistory.slice(0, 3);

  return (
    <BillingRouteGuard allowedStates={["active", "reactivated"]}>
      <BillingPageShell tone="calm">
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && !error && (
          <div className="grid gap-10">
            <BillingHero
              headline="המנוי שלך פעיל"
              subheadline="נטלי ממשיכה לעבוד איתך כרגיל."
            />

            <div className="grid gap-4 md:grid-cols-3">
              <BillingValueCard label="איך נטלי עובדת איתך" value={getPlanDisplayName(summary.planName)} accent="emerald" />
              <BillingValueCard
                label="חיוב הבא"
                value={summary.nextBillingAt ? new Date(summary.nextBillingAt).toLocaleDateString("he-IL") : "—"}
                accent="blue"
              />
              <BillingValueCard label="שעות שנחסכו מאז החיוב האחרון" value={hours} accent="violet" icon="⏱️" />
            </div>

            <div className="grid gap-4">
              <h3 className="text-xl font-extrabold text-slate-900 md:text-2xl">מה נטלי עשתה מאז החיוב האחרון</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <BillingValueCard label="מסמכים שטופלו" value={documents} accent="blue" icon="📄" />
                <BillingValueCard label="תשלומים שזוהו" value={payments} accent="indigo" icon="💳" />
                <BillingValueCard label="שעות שנחסכו" value={hours} accent="violet" icon="⏱️" />
              </div>
            </div>

            <div className="grid gap-4">
              <h3 className="text-xl font-extrabold text-slate-900">היסטוריית חיובים</h3>
              {empty || billingHistory.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 text-base text-slate-600">
                  אין כרגע היסטוריית חיובים להצגה.
                </div>
              ) : (
                <ul className="grid gap-3">
                  {recentHistory.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-base font-bold text-slate-900">{item.description}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {new Date(item.date).toLocaleDateString("he-IL")} · ₪{item.amount}
                        </p>
                      </div>
                      <span
                        className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-bold ${
                          item.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {item.status === "paid" ? "שולם" : "בהמתנה"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <BillingCTAGroup
              primary={<BillingPrimaryLink href={BILLING_ROUTES.manage}>ניהול המנוי</BillingPrimaryLink>}
              secondary={<BillingSecondaryLink href={BILLING_ROUTES["payment-method"]}>עדכון אמצעי תשלום</BillingSecondaryLink>}
            />
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
