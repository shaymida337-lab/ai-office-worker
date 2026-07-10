"use client";

import { natalie, shellLayout } from "./tokens";

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/95 backdrop-blur">
      <div className={`${shellLayout.contentMaxWidth} ${shellLayout.contentPaddingX} flex h-16 flex-col justify-center py-2`}>
        {subtitle ? <p className={`text-sm font-semibold leading-tight ${natalie.accent}`}>{subtitle}</p> : null}
        <h1 className={`text-xl font-black leading-tight md:text-2xl ${natalie.title}`}>{title}</h1>
      </div>
    </div>
  );
}
