"use client";

import type { ReactNode } from "react";

export function BillingPageShell({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "warm" | "calm";
}) {
  const toneClass =
    tone === "warm"
      ? "border-amber-100/80 bg-gradient-to-b from-amber-50/60 via-white to-white shadow-[0_24px_64px_-32px_rgba(245,158,11,0.35)]"
      : tone === "calm"
        ? "border-emerald-100/80 bg-gradient-to-b from-emerald-50/40 via-white to-white shadow-[0_24px_64px_-32px_rgba(16,185,129,0.2)]"
        : "border-slate-200/80 bg-gradient-to-b from-blue-50/50 via-white to-white shadow-[0_28px_80px_-36px_rgba(29,91,255,0.28)]";

  return (
    <section className={`overflow-hidden rounded-[1.75rem] border ${toneClass}`}>
      <div className="p-6 md:p-10 lg:p-12">{children}</div>
    </section>
  );
}
