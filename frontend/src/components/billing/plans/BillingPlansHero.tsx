"use client";

import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { BillingSecondaryLink } from "../ui/BillingCTA";
import { BILLING_ROUTES } from "@/lib/billing/model";
import { HERO_ACTIVITY_CHECKLIST, HERO_QUICK_BENEFITS } from "./plansContent";

export function BillingPlansHero() {
  return (
    <section className="relative overflow-visible rounded-[1.75rem] border border-slate-200/80 bg-white px-5 py-10 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.2)] sm:px-8 md:py-12 lg:px-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-blue-50/80 to-transparent" aria-hidden />

      <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-14">
        {/* Copy — start side in RTL */}
        <div className="grid min-w-0 gap-6 text-right">
          <h1 className="text-[1.75rem] font-extrabold leading-[1.12] tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem]">
            עובדת המשרד הראשונה
            <br />
            מבוססת AI
            <br />
            לעסק שלך
          </h1>
          <p className="max-w-xl text-base leading-8 text-slate-600 sm:text-lg sm:leading-9">
            נטלי קוראת מיילים, סורקת מסמכים, מנפיקה חשבוניות וקבלות, קובעת פגישות, מנהלת משימות, עוקבת אחרי תשלומים
            ומנהלת את העבודה המשרדית שלך — 24/7.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href="#pricing"
              className="inline-flex min-h-[3.25rem] items-center justify-center rounded-xl bg-blue-600 px-7 py-3.5 text-center text-base font-bold text-white shadow-[0_12px_32px_-12px_rgba(37,99,235,0.55)] transition hover:bg-blue-700"
            >
              התחל לעבוד עם נטלי
            </a>
            <BillingSecondaryLink href={BILLING_ROUTES["value-report"]}>ראו את נטלי בפעולה</BillingSecondaryLink>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-slate-600">
            {HERO_QUICK_BENEFITS.map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <span className="text-emerald-600" aria-hidden>
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Portrait + checklist — end side in RTL (visual left) */}
        <div className="mx-auto grid w-full max-w-[340px] min-w-0 gap-4 lg:mx-0 lg:max-w-none">
          <div className="relative mx-auto w-full max-w-[240px] lg:mx-0">
            <NataliePortrait size="hero" showStatusDot />
            <div
              className="absolute -top-2 left-0 max-w-[12rem] rounded-2xl rounded-br-sm border border-blue-100 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-md sm:-left-4"
              role="note"
            >
              שלום! אני נטלי — עובדת המשרד שלך 👋
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm sm:p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-blue-700">פעילות חיה</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {HERO_ACTIVITY_CHECKLIST.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
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
