import { WORKDAY_STORY } from "../conversionCopy";

export function BillingPlansWorkdaySection() {
  return (
    <section className="rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white px-6 py-8 md:px-10 md:py-10">
      <h2 className="mb-8 text-2xl font-extrabold text-slate-900 md:text-3xl">ככה נראה יום עבודה עם נטלי</h2>
      <ol className="grid gap-6 md:grid-cols-2 md:gap-8">
        {WORKDAY_STORY.map((step, index) => (
          <li key={step.phase} className="relative grid gap-2 pr-4 text-right">
            <span className="text-sm font-bold uppercase tracking-wide text-blue-600">{step.phase}</span>
            <p className="text-base leading-8 text-slate-700 md:text-lg">{step.text}</p>
            {index < WORKDAY_STORY.length - 1 && (
              <span className="absolute -bottom-3 left-1/2 hidden h-px w-full -translate-x-1/2 bg-slate-200 md:block" aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
