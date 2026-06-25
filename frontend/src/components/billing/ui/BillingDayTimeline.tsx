import { BILLING_DAY_TIMELINE } from "../conversionCopy";

export function BillingDayTimeline() {
  return (
    <section className="grid gap-6">
      <h2 className="text-2xl font-extrabold text-slate-900 md:text-3xl">כך נטלי משנה את יום העבודה שלך</h2>
      <div className="rounded-[1.5rem] border border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white p-6 md:p-8">
        <p className="mb-6 text-sm font-bold uppercase tracking-wide text-slate-500">בוקר</p>
        <ol className="grid gap-0">
          {BILLING_DAY_TIMELINE.map((step, index) => (
            <li key={step.text} className="grid gap-0">
              <div className="flex items-start gap-4 rounded-2xl px-2 py-3 transition hover:bg-white/70">
                <span className="text-2xl" aria-hidden>
                  {step.icon}
                </span>
                <p className="pt-0.5 text-base font-semibold leading-8 text-slate-800 md:text-lg">{step.text}</p>
              </div>
              {index < BILLING_DAY_TIMELINE.length - 1 && (
                <div className="flex justify-center py-1 text-slate-300" aria-hidden>
                  ↓
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-6 text-center text-base font-semibold text-blue-700 md:text-lg">זה קורה אוטומטית. בלי שתרדוף אחרי כלום.</p>
      </div>
    </section>
  );
}
