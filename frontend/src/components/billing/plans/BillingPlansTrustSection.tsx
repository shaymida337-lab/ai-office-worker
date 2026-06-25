import { LANDING_TRUST_STRIP } from "./plansContent";

export function BillingPlansTrustSection() {
  return (
    <section className="overflow-visible rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 md:px-6">
      <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {LANDING_TRUST_STRIP.map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm font-semibold text-slate-700 md:text-base">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700" aria-hidden>
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
