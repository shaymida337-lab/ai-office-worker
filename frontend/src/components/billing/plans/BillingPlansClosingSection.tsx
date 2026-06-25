import type { ReactNode } from "react";

export function BillingPlansClosingSection({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[2rem] border border-blue-200/60 bg-gradient-to-l from-blue-600 to-indigo-700 px-6 py-12 text-center text-white shadow-[0_32px_64px_-32px_rgba(29,91,255,0.5)] md:px-12 md:py-14">
      <h2 className="text-2xl font-extrabold leading-tight md:text-4xl">מוכן להפסיק לעבוד על הניירת?</h2>
      <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-blue-100 md:text-lg">
        מהיום נטלי תעשה את העבודה המשרדית. אתה תחזור לנהל את העסק.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">{children}</div>
    </section>
  );
}
