import type { BillingPlan } from "@/lib/billing/model";

export function PlanCard({
  plan,
  selected = false,
  onSelect,
}: {
  plan: BillingPlan;
  selected?: boolean;
  onSelect?: (planId: BillingPlan["id"]) => void;
}) {
  return (
    <article
      className={`rounded-2xl border p-5 ${
        selected
          ? "border-blue-500 bg-blue-50"
          : plan.recommended
            ? "border-indigo-300 bg-indigo-50/50"
            : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
          <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
        </div>
        {plan.recommended && (
          <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-700">מומלץ</span>
        )}
      </div>
      <p className="mt-4 text-2xl font-extrabold text-slate-900">₪{plan.priceMonthly}</p>
      <p className="text-xs font-semibold text-slate-500">לחודש</p>
      <ul className="mt-4 grid gap-1 text-sm text-slate-700">
        {plan.highlights.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
      {onSelect && (
        <button
          type="button"
          onClick={() => onSelect(plan.id)}
          className={`mt-5 w-full rounded-xl border px-4 py-2.5 text-sm font-bold ${
            selected
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
          }`}
        >
          {selected ? "נבחר" : "בחר מסלול"}
        </button>
      )}
    </article>
  );
}
