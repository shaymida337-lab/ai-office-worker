"use client";

import { natalie } from "./tokens";

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/95 px-4 py-4 backdrop-blur md:px-6">
      <div className="mx-auto w-full max-w-6xl xl:max-w-7xl">
        {subtitle ? <p className={`text-sm font-semibold ${natalie.accent}`}>{subtitle}</p> : null}
        <h1 className={`text-2xl font-black md:text-3xl ${natalie.title}`}>{title}</h1>
      </div>
    </div>
  );
}
