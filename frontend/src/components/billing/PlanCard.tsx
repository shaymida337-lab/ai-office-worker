import type { BillingPlan } from "@/lib/billing/model";

const PLAN_DISPLAY_COPY: Partial<Record<BillingPlan["id"], { description: string }>> = {
  starter: {
    description: "לעסק קטן שרוצה סדר במסמכים, חשבוניות ותשלומים בלי להתעסק ידנית.",
  },
  growth: {
    description: "לעסק שרוצה שנטלי תוריד ממנו יותר עבודה ותנהל יותר מהשגרה המשרדית.",
  },
};

export function PlanCard({
  plan,
  selected = false,
  onSelect,
}: {
  plan: BillingPlan;
  selected?: boolean;
  onSelect?: (planId: BillingPlan["id"]) => void;
}) {
  const displayDescription = PLAN_DISPLAY_COPY[plan.id]?.description ?? plan.description;
  const isRecommended = plan.recommended;

  return (
    <article
      className={`relative flex h-full flex-col rounded-[1.5rem] border p-6 transition md:p-7 ${
        isRecommended
          ? "scale-[1.02] border-blue-400 bg-gradient-to-b from-blue-50/80 via-white to-white shadow-[0_20px_50px_-24px_rgba(29,91,255,0.45)] md:scale-[1.03]"
          : "border-slate-200 bg-white shadow-[0_12px_40px_-28px_rgba(15,23,42,0.2)]"
      } ${selected ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
    >
      {isRecommended && (
        <span className="absolute -top-3 right-5 rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-4 py-1 text-xs font-extrabold text-white shadow-md">
          מומלץ
        </span>
      )}
      <div className="grid gap-2">
        <h3 className="text-2xl font-extrabold text-slate-900">{plan.name}</h3>
        <p className="text-base leading-7 text-slate-600">{displayDescription}</p>
      </div>
      <div className="mt-6">
        <p className="text-4xl font-extrabold tracking-tight text-slate-900">₪{plan.priceMonthly}</p>
        <p className="mt-1 text-sm font-semibold text-slate-500">לחודש · בלי התחייבות</p>
      </div>
      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {plan.highlights.slice(0, 5).map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-base text-slate-700">
            <CheckIcon className="mt-0.5 shrink-0 text-blue-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {onSelect && (
        <button
          type="button"
          onClick={() => onSelect(plan.id)}
          className={`mt-8 w-full rounded-2xl px-5 py-3.5 text-base font-bold transition ${
            selected
              ? "bg-gradient-to-l from-blue-600 to-blue-700 text-white shadow-[0_12px_28px_-12px_rgba(29,91,255,0.55)]"
              : "border border-slate-300 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50/50"
          }`}
        >
          {selected ? "נבחר" : "בחר מסלול"}
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
