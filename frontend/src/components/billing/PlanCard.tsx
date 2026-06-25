import type { BillingPlan } from "@/lib/billing/model";
import { formatPlanPrice, PLAN_CONVERSION_COPY } from "./conversionCopy";

export function PlanCard({
  plan,
  selected = false,
  onSelect,
  onChoose,
}: {
  plan: BillingPlan;
  selected?: boolean;
  onSelect?: (planId: BillingPlan["id"]) => void;
  onChoose?: (planId: BillingPlan["id"]) => void;
}) {
  const copy = PLAN_CONVERSION_COPY[plan.id];
  const isRecommended = plan.recommended;
  const handleClick = () => {
    onSelect?.(plan.id);
    onChoose?.(plan.id);
  };

  return (
    <article
      className={`relative flex h-full min-w-0 flex-col overflow-visible rounded-[1.75rem] border p-6 transition sm:p-7 md:p-8 ${
        isRecommended
          ? "border-blue-400 bg-gradient-to-b from-blue-50 via-white to-white shadow-[0_28px_60px_-24px_rgba(29,91,255,0.45)] ring-1 ring-blue-300/60"
          : "border-slate-200/90 bg-white shadow-[0_16px_44px_-30px_rgba(15,23,42,0.18)]"
      } ${selected ? "ring-[3px] ring-blue-500 ring-offset-2" : ""}`}
    >
      {isRecommended && (
        <span className="absolute right-5 top-0 -translate-y-1/2 rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-4 py-1.5 text-xs font-extrabold text-white shadow-md sm:text-sm">
          מומלץ
        </span>
      )}

      <div className={`grid gap-3 ${isRecommended ? "pt-2" : ""}`}>
        <h3 className="text-xl font-extrabold text-slate-900 sm:text-2xl lg:text-3xl">{copy.name}</h3>
        <p className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl md:text-4xl">{formatPlanPrice(plan.priceMonthly)}</p>
        <p className="text-base leading-8 text-slate-600">{copy.positioning}</p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3 border-t border-slate-100 pt-6 sm:mt-8 sm:gap-3.5 sm:pt-8">
        {copy.includes.map((item) => (
          <li key={item.text} className="flex items-start gap-3 text-sm leading-7 text-slate-700 sm:text-base">
            <CheckIcon className={`mt-0.5 shrink-0 ${isRecommended ? "text-blue-600" : "text-slate-500"}`} />
            <span className={`min-w-0 break-words ${item.emphasis ? "font-extrabold text-slate-900" : ""}`}>{item.text}</span>
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-center text-sm font-bold leading-7 text-slate-700 sm:mt-8 sm:text-base">
        {copy.finalLine}
      </p>

      {onSelect && (
        <button
          type="button"
          onClick={handleClick}
          className={`mt-5 w-full rounded-2xl px-5 py-3.5 text-base font-bold transition sm:mt-6 sm:py-4 ${
            selected || isRecommended
              ? "bg-gradient-to-l from-blue-600 to-blue-700 text-white shadow-[0_14px_32px_-14px_rgba(29,91,255,0.55)] hover:from-blue-700 hover:to-blue-800"
              : "border-2 border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50/40"
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
