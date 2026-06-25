import type { BillingPlan } from "@/lib/billing/model";
import { PLAN_CONVERSION_COPY } from "./conversionCopy";

export function PlanCard({
  plan,
  selected = false,
  onSelect,
}: {
  plan: BillingPlan;
  selected?: boolean;
  onSelect?: (planId: BillingPlan["id"]) => void;
}) {
  const copy = PLAN_CONVERSION_COPY[plan.id];
  const isRecommended = plan.recommended;

  return (
    <article
      className={`relative flex h-full flex-col rounded-[1.5rem] border p-6 transition md:p-8 ${
        isRecommended
          ? "scale-[1.02] border-blue-400 bg-gradient-to-b from-blue-50/80 via-white to-white shadow-[0_24px_56px_-28px_rgba(29,91,255,0.5)] md:scale-[1.03]"
          : "border-slate-200 bg-white shadow-[0_16px_48px_-32px_rgba(15,23,42,0.22)]"
      } ${selected ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
    >
      {isRecommended && (
        <span className="absolute -top-3 right-5 rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-4 py-1 text-xs font-extrabold text-white shadow-md">
          מומלץ
        </span>
      )}
      <div className="grid gap-3">
        <h3 className="text-2xl font-extrabold text-slate-900 md:text-3xl">{copy.name}</h3>
        <p className="text-base leading-8 text-slate-600 md:text-lg">{copy.subheadline}</p>
        <p className="text-sm font-bold text-blue-700 md:text-base">{copy.responsibility}</p>
      </div>
      <div className="mt-6 border-t border-slate-100 pt-6">
        <p className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">₪{plan.priceMonthly}</p>
        <p className="mt-1 text-sm font-semibold text-slate-500">לחודש · בלי התחייבות</p>
      </div>
      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {copy.outcomes.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-base leading-7 text-slate-700">
            <CheckIcon className="mt-1 shrink-0 text-blue-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {onSelect && (
        <button
          type="button"
          onClick={() => onSelect(plan.id)}
          className={`mt-8 w-full rounded-2xl px-5 py-4 text-base font-bold transition ${
            selected
              ? "bg-gradient-to-l from-blue-600 to-blue-700 text-white shadow-[0_12px_28px_-12px_rgba(29,91,255,0.55)]"
              : "border border-slate-300 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50/50"
          }`}
        >
          {selected ? copy.selectedLabel : copy.selectLabel}
        </button>
      )}
    </article>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`h-5 w-5 ${className ?? ""}`} aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.25a1 1 0 0 1-1.414 0l-3.25-3.25a1 1 0 1 1 1.414-1.414l2.543 2.543 6.543-6.543a1 1 0 0 1 1.412 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
