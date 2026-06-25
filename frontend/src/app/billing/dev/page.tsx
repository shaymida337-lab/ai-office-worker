"use client";

import Link from "next/link";
import { useBilling } from "@/components/billing";
import { BILLING_ROUTES, BILLING_SUBSCRIPTION_STATES } from "@/lib/billing/model";

export default function BillingDevPage() {
  const { summary, setMockState } = useBilling();

  if (process.env.NODE_ENV === "production") {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
        מסך זה זמין רק בסביבת פיתוח.
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
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
            <Link key={key} href={route} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100">
              {route}
            </Link>
          ))}
        </nav>
      </section>
    </section>
  );
}
