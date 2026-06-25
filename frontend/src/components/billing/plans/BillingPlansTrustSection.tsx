import { PLANS_TRUST_ITEMS } from "../conversionCopy";

export function BillingPlansTrustSection() {
  return (
    <section className="grid gap-5">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {PLANS_TRUST_ITEMS.map((item) => (
          <li
            key={item.label}
            className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-4 py-5 text-center shadow-sm"
          >
            <span className="text-2xl" aria-hidden>
              {item.icon}
            </span>
            <span className="text-sm font-bold leading-6 text-slate-700 md:text-base">{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
