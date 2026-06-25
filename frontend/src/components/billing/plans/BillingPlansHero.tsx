"use client";

import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { BillingSecondaryLink } from "../ui/BillingCTA";
import { BILLING_ROUTES } from "@/lib/billing/model";
import { HERO_ACTIVITY_CHECKLIST } from "./plansContent";

export function BillingPlansHero() {
  return (
    <section className="relative overflow-visible rounded-[2rem] border border-blue-200/50 bg-gradient-to-bl from-blue-100/80 via-white to-indigo-50/40 px-5 py-10 shadow-[0_32px_80px_-40px_rgba(29,91,255,0.35)] sm:px-8 md:px-10 md:py-12 lg:px-12">
      <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-blue-200/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-indigo-200/25 blur-3xl" aria-hidden />

      <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] lg:items-start lg:gap-12">
        <div className="grid min-w-0 gap-6 text-right">
          <p className="text-sm font-bold text-blue-700 md:text-base">AI Office Worker לעסק שלך</p>
          <h1 className="text-[1.65rem] font-extrabold leading-[1.15] tracking-tight text-slate-900 sm:text-4xl lg:text-[2.65rem]">
            עובדת המשרד הראשונה מבוססת AI לעסק שלך
          </h1>
          <p className="max-w-2xl text-base leading-8 text-slate-600 sm:text-lg sm:leading-9">
            נטלי קוראת מיילים, סורקת מסמכים, מנפיקה חשבוניות וקבלות, קובעת פגישות, מנהלת משימות, עוקבת אחרי תשלומים
            ומנהלת את העבודה המשרדית שלך — 24/7.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href="#pricing"
              className="inline-flex min-h-[3.25rem] items-center justify-center rounded-2xl bg-gradient-to-l from-blue-600 to-blue-700 px-6 py-3.5 text-center text-base font-bold text-white shadow-[0_16px_40px_-12px_rgba(29,91,255,0.55)] transition hover:from-blue-700 hover:to-blue-800 sm:px-8"
            >
              התחל לעבוד עם נטלי
            </a>
            <BillingSecondaryLink href={BILLING_ROUTES["value-report"]}>ראו את נטלי בפעולה</BillingSecondaryLink>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-[320px] min-w-0 gap-5 lg:mx-0">
          <div className="mx-auto w-full max-w-[220px] lg:max-w-none">
            <NataliePortrait size="hero" showStatusDot />
          </div>
          <div className="rounded-2xl border border-blue-200/70 bg-white/90 p-4 shadow-sm sm:p-5">
            <p className="mb-3 text-sm font-bold text-blue-800">נטלי עובדת עכשיו</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {HERO_ACTIVITY_CHECKLIST.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700 sm:text-[0.9rem]">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-600" aria-hidden>
                    ✓
                  </span>
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
