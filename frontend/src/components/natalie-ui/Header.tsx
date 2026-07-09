"use client";

import type { ReactNode } from "react";
import { natalie } from "./tokens";
import { Button } from "./Button";

export function Header({
  title,
  subtitle,
  onRefresh,
  refreshLabel,
  actions,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className={natalie.header}>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 md:h-20 md:px-6 xl:max-w-7xl">
        <div className="min-w-0">
          {subtitle ? <p className={`truncate text-sm font-semibold ${natalie.accent}`}>{subtitle}</p> : null}
          <h1 className={`truncate text-xl font-black md:text-2xl ${natalie.title}`}>{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onRefresh && refreshLabel ? (
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              {refreshLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
