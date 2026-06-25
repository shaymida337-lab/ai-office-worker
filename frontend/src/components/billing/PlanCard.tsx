import type { BillingPlan } from "@/lib/billing/model";
import { formatPlanPrice, PLAN_CONVERSION_COPY } from "./conversionCopy";

export function PlanCard({
  plan,
  selected = false,
  compact = false,
  onSelect,
  onChoose,
}: {
  plan: BillingPlan;
  selected?: boolean;
  compact?: boolean;
  onSelect?: (planId: BillingPlan["id"]) => void;
  onChoose?: (planId: BillingPlan["id"]) => void;
}) {
  const copy = PLAN_CONVERSION_COPY[plan.id];
  const isRecommended = plan.recommended;
  const handleClick = () => {
    onSelect?.(plan.id);
    onChoose?.(plan.id);
  };

  const shell = compact
    ? isRecommended
      ? "border-blue-400 bg-gradient-to-b from-blue-50 via-white to-white p-5 shadow-[0_20px_48px_-24px_rgba(29,91,255,0.4)] ring-1 ring-blue-300/60 sm:p-6 lg:p-7"
      : "border-slate-200/90 bg-white p-5 shadow-[0_12px_36px_-28px_rgba(15,23,42,0.18)] sm:p-6"
    : isRecommended
      ? "border-blue-400 bg-gradient-to-b from-blue-50 via-white to-white p-6 shadow-[0_28px_60px_-24px_rgba(29,91,255,0.45)] ring-1 ring-blue-300/60 sm:p-7 md:p-8"
      : "border-slate-200/90 bg-white p-6 shadow-[0_16px_44px_-30px_rgba(15,23,42,0.18)] sm:p-7 md:p-8";

  return (
    <article
      className={`relative flex h-full min-w-0 flex-col overflow-visible rounded-[1.75rem] border transition ${shell} ${selected ? "ring-[3px] ring-blue-500 ring-offset-2" : ""}`}
    >
      {isRecommended && (
        <span
          className={`absolute right-5 top-0 -translate-y-1/2 rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-4 py-1.5 font-extrabold text-white shadow-md ${compact ? "text-xs sm:text-sm" : "text-xs sm:text-sm"}`}
        >
          מומלץ
        </span>
      )}

      <div className={`grid gap-2 ${isRecommended ? "pt-2" : ""} ${compact ? "sm:gap-2.5" : "gap-3"}`}>
        <h3
          className={
            compact
              ? `font-extrabold text-slate-900 ${isRecommended ? "text-xl sm:text-2xl lg:text-[1.65rem]" : "text-lg sm:text-xl lg:text-2xl"}`
              : "text-xl font-extrabold text-slate-900 sm:text-2xl lg:text-3xl"
          }
        >
          {copy.name}
        </h3>
        <p
          className={
            compact
              ? "text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl"
              : "text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl md:text-4xl"
          }
        >
          {formatPlanPrice(plan.priceMonthly)}
        </p>
        <p className={compact ? "text-sm leading-7 text-slate-600 sm:text-base sm:leading-8" : "text-base leading-8 text-slate-600"}>
          {copy.positioning}
        </p>
      </div>

      <ul
        className={`flex flex-1 flex-col border-t border-slate-100 ${
          compact ? "mt-4 gap-2 pt-4 sm:mt-5 sm:pt-5" : "mt-6 gap-3 pt-6 sm:mt-8 sm:gap-3.5 sm:pt-8"
        }`}
      >
        {copy.includes.map((item) => (
          <li
            key={item.text}
            className={`flex items-start gap-2.5 text-slate-700 ${compact ? "text-sm leading-6" : "gap-3 text-sm leading-7 sm:text-base"}`}
          >
            <CheckIcon className={`mt-0.5 shrink-0 ${isRecommended ? "text-blue-600" : "text-slate-500"}`} compact={compact} />
            <span className={`min-w-0 break-words ${item.emphasis ? "font-extrabold text-slate-900" : ""}`}>{item.text}</span>
          </li>
        ))}
      </ul>

      <p
        className={
          compact
            ? "mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-center text-xs font-bold leading-6 text-slate-700 sm:mt-5 sm:text-sm sm:leading-7"
            : "mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-center text-sm font-bold leading-7 text-slate-700 sm:mt-8 sm:text-base"
        }
      >
        {copy.finalLine}
      </p>

      {onSelect && (
        <button
          type="button"
          onClick={handleClick}
          className={`mt-auto w-full rounded-2xl px-5 font-bold transition ${
            compact ? "mt-4 py-3 text-sm sm:mt-5 sm:py-3.5 sm:text-base" : "mt-5 py-3.5 text-base sm:mt-6 sm:py-4"
          } ${
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

function CheckIcon({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`${compact ? "h-4 w-4" : "h-5 w-5"} ${className ?? ""}`} aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.25a1 1 0 0 1-1.414 0l-3.25-3.25a1 1 0 1 1 1.414-1.414l2.543 2.543 6.543-6.543a1 1 0 0 1 1.412 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
