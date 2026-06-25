import type { ReactNode } from "react";

export function BillingPlansClosingSection({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-visible rounded-[2rem] border border-blue-200/60 bg-gradient-to-l from-blue-600 to-indigo-700 px-5 py-10 text-center text-white shadow-[0_32px_64px_-32px_rgba(29,91,255,0.5)] sm:px-10 sm:py-12 md:px-12 md:py-14">
      <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl md:text-4xl">
        העסק שלך עובד קשה.
        <br />
        הגיע הזמן שגם עובדת המשרד שלך תעבוד בשבילך.
      </h2>
      <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:justify-center">{children}</div>
    </section>
  );
}
