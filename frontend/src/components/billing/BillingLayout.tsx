"use client";

import Link from "next/link";
import { BILLING_ROUTES, BILLING_SUBSCRIPTION_STATES } from "@/lib/billing/model";
import { useBilling } from "./BillingContext";
import { BillingBanner } from "./BillingBanner";
import { SubscriptionStatusCard } from "./SubscriptionStatusCard";

export function BillingLayout({ children }: { children: React.ReactNode }) {
  const { summary, setMockState } = useBilling();
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-24 pt-20 md:px-8 lg:mr-60">
      <div className="mx-auto grid max-w-5xl gap-4">
        <h1 className="text-2xl font-extrabold text-slate-900">Billing Foundation</h1>
        <BillingBanner summary={summary} />
        <SubscriptionStatusCard summary={summary} />
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-800">QA Mock State Switcher</h2>
          <div className="flex flex-wrap gap-2">
            {BILLING_SUBSCRIPTION_STATES.map((state) => (
              <button
                key={state}
                type="button"
                onClick={() => setMockState(state)}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold ${
                  summary.status === state ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                {state}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-800">Billing Routes</h2>
          <nav className="grid gap-2 text-sm md:grid-cols-2">
            {Object.entries(BILLING_ROUTES).map(([key, route]) => (
              <Link key={key} href={route} className="rounded-md border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-100">
                {route}
              </Link>
            ))}
          </nav>
        </section>
        {children}
      </div>
    </main>
  );
}
