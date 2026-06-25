import type { ReactNode } from "react";

const TRUST_ITEMS = [
  { icon: "🔒", label: "הנתונים שלך מאובטחים." },
  { icon: "📄", label: "כל מסמך נשמר אוטומטית." },
  { icon: "🔄", label: "אפשר לבטל בכל רגע." },
  { icon: "🇮🇱", label: "תמיכה מלאה בעברית." },
] as const;

export function BillingTrustStrip() {
  return (
    <section className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/60 px-5 py-6 md:px-8 md:py-7">
      <h3 className="mb-5 text-center text-xl font-extrabold text-slate-900 md:text-2xl">אפשר לסמוך על נטלי.</h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TRUST_ITEMS.map((item) => (
          <li key={item.label} className="flex items-center gap-3 rounded-xl bg-white/80 px-4 py-3 text-base font-semibold text-slate-700">
            <span className="text-xl" aria-hidden>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BillingFinalCTA({
  headline = "כמה עבודה אתה רוצה להוריד מהכתפיים שלך?",
  children,
}: {
  headline?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 rounded-[1.75rem] border border-slate-200 bg-white px-6 py-10 text-center shadow-[0_24px_64px_-40px_rgba(15,23,42,0.25)] md:px-10 md:py-12">
      <h3 className="text-2xl font-extrabold leading-tight text-slate-900 md:text-3xl">{headline}</h3>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">{children}</div>
    </section>
  );
}
