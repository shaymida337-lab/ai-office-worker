import { RELIEF_CARDS } from "../conversionCopy";

export function BillingPlansReliefSection() {
  return (
    <section className="grid gap-8">
      <div className="grid gap-3 text-right">
        <h2 className="text-2xl font-extrabold text-slate-900 md:text-4xl">מה נטלי מורידה ממך</h2>
        <p className="max-w-2xl text-base leading-8 text-slate-600 md:text-lg">פחות לרדוף. פחות לחפש. פחות לדאוג.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RELIEF_CARDS.map((card) => (
          <article
            key={card.title}
            className="group rounded-[1.5rem] border border-slate-200/80 bg-white p-6 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.15)] transition hover:border-blue-200 hover:shadow-[0_20px_48px_-28px_rgba(29,91,255,0.2)] md:p-7"
          >
            <span className="text-3xl" aria-hidden>
              {card.icon}
            </span>
            <h3 className="mt-4 text-lg font-extrabold leading-snug text-slate-900 md:text-xl">{card.title}</h3>
            <p className="mt-2 text-base leading-7 text-slate-600">{card.subtitle}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
