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
      ? "border-blue-400 bg-gradient-to-b from-blue-50 via-white to-white p-4 shadow-[0_20px_48px_-24px_rgba(29,91,255,0.4)] ring-1 ring-blue-300/60 lg:p-5"
      : "border-slate-200/90 bg-white p-4 shadow-[0_12px_36px_-28px_rgba(15,23,42,0.18)] lg:p-5"
    : isRecommended
      ? "border-blue-400 bg-gradient-to-b from-blue-50 via-white to-white p-6 shadow-[0_28px_60px_-24px_rgba(29,91,255,0.45)] ring-1 ring-blue-300/60 sm:p-7 md:p-8"
      : "border-slate-200/90 bg-white p-6 shadow-[0_16px_44px_-30px_rgba(15,23,42,0.18)] sm:p-7 md:p-8";

  return (
    <article
      className={`relative flex h-full min-w-0 flex-col overflow-visible rounded-[1.75rem] border transition ${shell} ${selected ? "ring-[3px] ring-blue-500 ring-offset-2" : ""}`}
    >
      {isRecommended && (
        <span
          className="absolute right-5 top-0 -translate-y-1/2 rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-4 py-1.5 text-xs font-extrabold text-white shadow-md sm:text-sm"
        >
          ⭐ הפופולרית ביותר
        </span>
      )}

      <div className={`grid ${isRecommended ? "pt-1" : ""} ${compact ? "gap-1" : "gap-1.5"}`}>
        <h3
          className={
            compact
              ? `font-extrabold text-slate-900 ${isRecommended ? "text-lg sm:text-xl lg:text-[1.4rem]" : "text-base sm:text-lg lg:text-xl"}`
              : "text-xl font-extrabold text-slate-900 sm:text-2xl lg:text-3xl"
          }
        >
          {copy.name}
        </h3>
        <p
          className={
            compact
              ? `font-black tracking-tight text-slate-900 ${isRecommended ? "text-[2rem] sm:text-[2.75rem]" : "text-[1.75rem] sm:text-4xl"}`
              : `font-black tracking-tight text-slate-900 ${isRecommended ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"}`
          }
        >
          {formatPlanPrice(plan.priceMonthly)}
        </p>
        <p className={compact ? "text-xs leading-5 text-slate-600 sm:text-sm" : "text-base leading-8 text-slate-600"}>
          {copy.positioning}
        </p>
      </div>

      <div
        className={`flex flex-1 flex-col border-t border-slate-100 ${
          compact ? "mt-2 gap-1 pt-2" : "mt-6 gap-4 pt-6"
        }`}
      >
        {copy.featureGroups.map((group) => (
          <div key={group.title} className="grid gap-0.5">
            <p className={`flex items-center gap-1.5 font-extrabold text-slate-900 ${compact ? "text-[0.8rem]" : "text-sm"}`}>
              <span aria-hidden>{group.icon}</span>
              <span>{group.title}</span>
            </p>
            <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
              {group.items.map((item) => (
                <li
                  key={item}
                  className={`flex items-start gap-1.5 text-slate-700 ${compact ? "text-[0.78rem] leading-[1.05rem]" : "text-sm leading-6"}`}
                >
                  <CheckIcon className={`mt-0.5 shrink-0 ${isRecommended ? "text-blue-600" : "text-slate-500"}`} compact />
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p
        className={
          compact
            ? "mt-2.5 rounded-xl bg-slate-50 px-3 py-1.5 text-center text-xs font-bold leading-4 text-slate-700 sm:text-[0.8rem]"
            : "mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-center text-sm font-bold leading-7 text-slate-700 sm:mt-8 sm:text-base"
        }
      >
        {copy.finalLineIcon ? `${copy.finalLineIcon} ` : ""}{copy.finalLine}
      </p>

      {onSelect && (
        <button
          type="button"
          onClick={handleClick}
          className={`mt-auto w-full rounded-2xl px-5 font-bold transition ${
            compact ? "mt-2.5 py-2 text-sm sm:py-2.5 sm:text-base" : "mt-5 py-3.5 text-base sm:mt-6 sm:py-4"
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
