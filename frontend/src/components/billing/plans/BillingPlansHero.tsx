"use client";

import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { BillingSecondaryLink } from "../ui/BillingCTA";
import { BILLING_ROUTES } from "@/lib/billing/model";

export function BillingPlansHero() {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-blue-200/50 bg-gradient-to-bl from-blue-100/80 via-white to-indigo-50/40 px-6 py-10 shadow-[0_32px_80px_-40px_rgba(29,91,255,0.35)] md:px-12 md:py-14 lg:px-14">
      <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-blue-200/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-indigo-200/25 blur-3xl" aria-hidden />

      <div className="relative grid gap-10 lg:grid-cols-[1fr_260px] lg:items-center lg:gap-14">
        <div className="grid gap-6 text-right">
          <p className="text-base font-bold text-blue-700 md:text-lg">תחזור לנהל את העסק. נטלי תנהל את המשרד.</p>
          <h1 className="text-[2rem] font-extrabold leading-[1.1] tracking-tight text-slate-900 md:text-5xl lg:text-[3.25rem]">
            העבודה המשרדית לא חייבת להיות עליך יותר
          </h1>
          <p className="max-w-2xl text-lg leading-9 text-slate-600 md:text-xl md:leading-10">
            נטלי קוראת את המייל, מזהה חשבוניות וקבלות, מסדרת הכל ב-Google Drive, מעדכנת Google Sheets ועוזרת לך לדעת
            בדיוק מה קורה בעסק — בלי לרדוף אחרי ניירת.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href="#pricing"
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-2xl bg-gradient-to-l from-blue-600 to-blue-700 px-8 py-4 text-center text-base font-bold text-white shadow-[0_16px_40px_-12px_rgba(29,91,255,0.55)] transition hover:from-blue-700 hover:to-blue-800 md:text-lg"
            >
              בחרו איך נטלי תעבוד איתכם
            </a>
            <BillingSecondaryLink href={BILLING_ROUTES["value-report"]}>ראו מה נטלי עושה</BillingSecondaryLink>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[220px] lg:mx-0 lg:max-w-[260px]">
          <NataliePortrait size="hero" showStatusDot />
        </div>
      </div>
    </section>
  );
}
