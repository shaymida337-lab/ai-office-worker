"use client";

import { NataliePortrait } from "@/components/dashboard/NataliePortrait";

export function BillingConversionHero() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-14">
      <div className="grid gap-6 text-right">
        <h1 className="text-[2rem] font-extrabold leading-[1.12] tracking-tight text-slate-900 md:text-5xl lg:text-[3.25rem]">
          העבודה המשרדית לא חייבת להיות עליך יותר.
        </h1>
        <div className="grid max-w-2xl gap-4 text-lg leading-9 text-slate-600 md:text-xl md:leading-10">
          <p className="font-semibold text-slate-700">יש עסקים שמעסיקים עובדת משרד. ויש עסקים שמעסיקים את נטלי.</p>
          <p>
            נטלי קוראת את החשבוניות, מסדרת את כל המסמכים, עוקבת אחרי התשלומים, ועוזרת לך לדעת בדיוק מה קורה בעסק — בלי
            לרדוף אחרי ניירת.
          </p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[240px] lg:mx-0 lg:max-w-[280px]">
        <NataliePortrait size="hero" showStatusDot />
      </div>
    </div>
  );
}
