import { LANDING_DAY_TIMELINE } from "./plansContent";

export function BillingPlansWorkdaySection() {
  return (
    <section className="overflow-visible rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white px-5 py-8 sm:px-8 md:py-10">
      <h2 className="mb-8 text-2xl font-extrabold text-slate-900 md:text-3xl">ככה נראה יום עבודה עם נטלי</h2>
      <ol className="relative grid gap-0">
        {LANDING_DAY_TIMELINE.map((step, index) => (
          <li key={step.time} className="relative flex gap-4 pb-8 text-right last:pb-0">
            {index < LANDING_DAY_TIMELINE.length - 1 && (
              <span
                className="absolute right-[1.35rem] top-8 bottom-0 w-px bg-gradient-to-b from-blue-300 to-slate-200"
                aria-hidden
              />
            )}
            <div className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-xs font-extrabold text-blue-700 shadow-sm">
              {step.time}
            </div>
            <div className="min-w-0 flex-1 pt-1.5">
              <p className="text-base leading-8 text-slate-800 md:text-lg">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
