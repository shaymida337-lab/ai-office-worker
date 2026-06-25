"use client";

import type { ReactNode } from "react";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";

export function BillingHero({
  headline,
  subheadline,
  badge,
  showPortrait = false,
  children,
}: {
  headline: string;
  subheadline?: string;
  badge?: string;
  showPortrait?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10">
      <div className="grid gap-4 text-right">
        {badge && (
          <span className="inline-flex w-fit items-center rounded-full bg-blue-100 px-4 py-1.5 text-sm font-bold text-blue-800">
            {badge}
          </span>
        )}
        <h2 className="text-[1.75rem] font-extrabold leading-[1.15] tracking-tight text-slate-900 md:text-4xl lg:text-[2.75rem]">
          {headline}
        </h2>
        {subheadline && (
          <p className="max-w-2xl text-base leading-8 text-slate-600 md:text-lg md:leading-9">{subheadline}</p>
        )}
        {children}
      </div>
      {showPortrait && (
        <div className="mx-auto w-full max-w-[200px] lg:mx-0 lg:max-w-[220px]">
          <NataliePortrait size="hero" showStatusDot />
        </div>
      )}
    </div>
  );
}
