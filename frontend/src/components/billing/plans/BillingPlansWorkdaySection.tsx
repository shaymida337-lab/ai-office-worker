import { LANDING_DAY_TIMELINE } from "./plansContent";
import { LandingReveal } from "./LandingReveal";

export function BillingPlansWorkdaySection() {
  return (
    <LandingReveal>
      <section className="overflow-visible rounded-2xl border border-slate-200/90 bg-white px-4 py-8 sm:px-6 md:py-10">
        <h2 className="mb-8 text-right text-2xl font-extrabold text-slate-900 md:text-3xl">ככה נראה יום עבודה עם נטלי</h2>

        {/* Mobile / narrow: horizontal scroll */}
        <div className="-mx-1 overflow-x-auto pb-2 lg:mx-0 lg:overflow-visible lg:pb-0">
          <ol className="flex min-w-max gap-3 px-1 lg:min-w-0 lg:grid lg:grid-cols-4 lg:gap-3 xl:grid-cols-8 xl:gap-2">
            {LANDING_DAY_TIMELINE.map((step, index) => (
              <li key={step.time} className="relative flex w-[9.5rem] shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-right transition duration-300 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-sm lg:w-auto lg:shrink">
                {index < LANDING_DAY_TIMELINE.length - 1 && (
                  <span className="absolute -left-2 top-1/2 hidden h-px w-4 bg-blue-200 xl:block" aria-hidden />
                )}
                <span className="text-xs font-extrabold text-blue-600">{step.time}</span>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </LandingReveal>
  );
}
