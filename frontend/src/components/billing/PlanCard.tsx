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
      className={`relative flex h-full flex-col rounded-[1.75rem] border p-7 transition md:p-9 ${
        isRecommended
          ? "z-10 scale-[1.03] border-blue-400 bg-gradient-to-b from-blue-50 via-white to-white shadow-[0_32px_64px_-28px_rgba(29,91,255,0.55)] md:scale-[1.05] lg:-mt-2 lg:mb-2"
          : "border-slate-200/90 bg-white shadow-[0_20px_50px_-32px_rgba(15,23,42,0.18)]"
      } ${selected ? "ring-[3px] ring-blue-500 ring-offset-2" : ""}`}
    >
      {isRecommended && (
        <span className="absolute -top-3.5 right-6 rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-5 py-1.5 text-sm font-extrabold text-white shadow-lg">
          מומלץ
        </span>
      )}

      <div className="grid gap-4">
        <h3 className="text-2xl font-extrabold text-slate-900 md:text-[1.75rem] lg:text-3xl">{copy.name}</h3>
        <p className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">{formatPlanPrice(plan.priceMonthly)}</p>
        <p className="text-base leading-8 text-slate-600 md:text-lg">{copy.positioning}</p>
      </div>

      <ul className="mt-8 flex flex-1 flex-col gap-3.5 border-t border-slate-100 pt-8">
        {copy.includes.map((item) => (
          <li key={item.text} className="flex items-start gap-3 text-base leading-7 text-slate-700">
            <CheckIcon className={`mt-1 shrink-0 ${isRecommended ? "text-blue-600" : "text-slate-500"}`} />
            <span className={item.emphasis ? "font-extrabold text-slate-900" : undefined}>{item.text}</span>
          </li>
        ))}
      </ul>

      <p className="mt-8 rounded-2xl bg-slate-50 px-4 py-3 text-center text-sm font-bold leading-7 text-slate-700 md:text-base">
        {copy.finalLine}
      </p>

      {onSelect && (
        <button
          type="button"
          onClick={handleClick}
          className={`mt-6 w-full rounded-2xl px-5 py-4 text-base font-bold transition md:text-lg ${
            selected || isRecommended
              ? "bg-gradient-to-l from-blue-600 to-blue-700 text-white shadow-[0_16px_36px_-14px_rgba(29,91,255,0.6)] hover:from-blue-700 hover:to-blue-800"
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
