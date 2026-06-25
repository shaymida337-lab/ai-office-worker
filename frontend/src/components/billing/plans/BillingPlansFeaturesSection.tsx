import { LANDING_FEATURE_CARDS } from "./plansContent";
import { LANDING_FEATURE_ICONS } from "./landingIcons";
import { LandingReveal } from "./LandingReveal";

export function BillingPlansFeaturesSection() {
  return (
    <LandingReveal>
      <section className="grid gap-8 overflow-visible">
        <div className="grid gap-2 text-right">
          <h2 className="text-2xl font-extrabold text-slate-900 md:text-3xl">מה נטלי עושה בשבילך</h2>
          <p className="text-base text-slate-600 md:text-lg">עובדת משרד אחת — במקום עשרה כלים.</p>
        </div>
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {LANDING_FEATURE_CARDS.map((card) => {
            const Icon = LANDING_FEATURE_ICONS[card.label];
            return (
              <article
                key={card.label}
                className="group flex min-h-[8.5rem] flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_8px_30px_-20px_rgba(15,23,42,0.25)] transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_16px_40px_-24px_rgba(37,99,235,0.25)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
                  {Icon ? <Icon className="h-5 w-5" strokeWidth={2} aria-hidden /> : null}
                </div>
                <h3 className="mt-4 text-base font-bold leading-snug text-slate-900">{card.label}</h3>
              </article>
            );
          })}
        </div>
      </section>
    </LandingReveal>
  );
}
