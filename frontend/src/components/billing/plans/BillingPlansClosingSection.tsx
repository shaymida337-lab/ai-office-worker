import type { ReactNode } from "react";

export function BillingPlansClosingSection({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-visible rounded-[1.75rem] border border-blue-200/50 bg-gradient-to-l from-blue-600 to-blue-700 px-5 py-10 text-center text-white shadow-[0_24px_56px_-32px_rgba(37,99,235,0.5)] sm:px-10 sm:py-12">
      <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl md:text-4xl">
        העסק שלך עובד קשה.
        <br />
        הגיע הזמן שגם עובדת המשרד שלך תעבוד בשבילך.
      </h2>
      <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:justify-center">{children}</div>
    </section>
  );
}
