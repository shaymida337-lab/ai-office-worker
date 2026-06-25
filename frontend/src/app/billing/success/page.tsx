"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BillingRouteGuard, InlineErrorCard, LoadingSkeleton, useBilling } from "@/components/billing";
import { getPlanDisplayName } from "@/components/billing/conversionCopy";
import { BillingPageShell, BillingPrimaryLink } from "@/components/billing/ui";
import { readFirstDayData } from "@/lib/natalie/firstDay";
import { BILLING_ROUTES } from "@/lib/billing/model";

export default function BillingSuccessPage() {
  const { loading, error, summary, refresh } = useBilling();
  const firstDay = readFirstDayData();
  const firstName = firstDay?.firstName ?? "שם";
  const businessName = firstDay?.businessName ?? summary.organizationName;

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
      <BillingPageShell tone="calm">
        {loading && <LoadingSkeleton />}
        {!!error && <InlineErrorCard message={error} />}

        {!loading && (
          <div className="grid gap-8 text-right">
            <div className="grid gap-3">
              <h2 className="text-3xl font-extrabold text-slate-900 md:text-4xl">נטלי ממשיכה לעבוד איתך 🎉</h2>
              <p className="text-lg leading-8 text-slate-600">
                מעולה, {firstName}. אני ממשיכה לעבוד עם {businessName} כרגיל.
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-6 text-base text-slate-700">
              <p>
                <span className="font-bold text-slate-900">המסלול הפעיל: </span>
                {getPlanDisplayName(summary.planName)}
              </p>
              <p>
                <span className="font-bold text-slate-900">החיוב הבא: </span>
                {summary.nextBillingAt ? new Date(summary.nextBillingAt).toLocaleDateString("he-IL") : "יוצג בקרוב"}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <BillingPrimaryLink href="/dashboard">חזרה לנטלי</BillingPrimaryLink>
              <Link
                href={BILLING_ROUTES.subscription}
                className="inline-flex min-h-[3.25rem] items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3.5 text-center text-base font-bold text-slate-800"
              >
                פרטי מנוי וקבלה
              </Link>
            </div>
          </div>
        )}
      </BillingPageShell>
    </BillingRouteGuard>
  );
}
