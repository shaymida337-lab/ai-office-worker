import { LANDING_TRUST_STRIP } from "./plansContent";

export function BillingPlansTrustSection() {
  return (
    <section className="overflow-visible rounded-2xl border border-slate-200/80 bg-slate-50/70 px-5 py-6 md:px-8 md:py-7">
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {LANDING_TRUST_STRIP.map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm font-bold text-slate-700 md:text-base">
            <span className="text-emerald-600" aria-hidden>
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
