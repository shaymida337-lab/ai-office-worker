import { LANDING_FEATURE_CARDS } from "./plansContent";

export function BillingPlansFeaturesSection() {
  return (
    <section className="grid gap-8 overflow-visible">
      <div className="grid gap-3 text-right">
        <h2 className="text-2xl font-extrabold text-slate-900 md:text-4xl">מה נטלי עושה בשבילך</h2>
        <p className="max-w-2xl text-base leading-8 text-slate-600 md:text-lg">עובדת משרד דיגיטלית אחת — במקום עשרה כלים נפרדים.</p>
      </div>
      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {LANDING_FEATURE_CARDS.map((card) => (
          <article
            key={card.label}
            className="flex min-h-[7.5rem] flex-col justify-center rounded-[1.25rem] border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_-28px_rgba(15,23,42,0.18)] transition hover:border-blue-200 md:min-h-[8.5rem] md:p-6"
          >
            <span className="text-2xl md:text-3xl" aria-hidden>
              {card.icon}
            </span>
            <h3 className="mt-3 text-base font-extrabold leading-snug text-slate-900 md:text-lg">{card.label}</h3>
          </article>
        ))}
      </div>
    </section>
  );
}
