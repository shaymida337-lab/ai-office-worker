"use client";

import Link from "next/link";
import { BILLING_ROUTES } from "@/lib/billing/model";
import { useBilling } from "./BillingContext";
import { BillingBanner } from "./BillingBanner";

export function BillingLayout({ children }: { children: React.ReactNode }) {
  const { summary } = useBilling();
  const showDevTools = process.env.NODE_ENV !== "production";
  return (
    <main className="min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-100 via-slate-50 to-white px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] pt-20 md:px-6 md:pb-32 lg:mr-60 lg:px-8 lg:pb-36">
      <div className="mx-auto grid w-full min-w-0 max-w-6xl gap-6">
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
