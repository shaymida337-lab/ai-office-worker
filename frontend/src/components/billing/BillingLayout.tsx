"use client";

import Link from "next/link";
import { BILLING_ROUTES } from "@/lib/billing/model";
import { useBilling } from "./BillingContext";
import { BillingBanner } from "./BillingBanner";

export function BillingLayout({ children }: { children: React.ReactNode }) {
  const { summary } = useBilling();
  const showDevTools = process.env.NODE_ENV !== "production";
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-24 pt-20 md:px-8 lg:mr-60">
      <div className="mx-auto grid max-w-4xl gap-5">
        <h1 className="text-2xl font-extrabold text-slate-900 md:text-3xl">ניהול מנוי ותשלומים</h1>
        <BillingBanner summary={summary} />
        {showDevTools && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-600">
            מצב פיתוח: כלי QA זמינים ב־
            <Link href={BILLING_ROUTES.trial.replace("/trial", "/dev")} className="font-bold text-blue-700 underline">
              /billing/dev
            </Link>
            .
          </div>
        )}
        {children}
      </div>
    </main>
  );
}
