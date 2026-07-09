"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { natalie } from "./tokens";

export function Card({
  children,
  className = "",
  padding = "md",
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
}) {
  const pad = padding === "none" ? "" : padding === "sm" ? "p-3" : padding === "lg" ? "p-5 md:p-6" : "p-4 md:p-5";
  return (
    <section className={`${natalie.card} ${pad} ${className}`} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {subtitle ? <div className={`text-sm font-bold ${natalie.accent}`}>{subtitle}</div> : null}
        <h2 className={`text-xl font-black md:text-2xl ${natalie.title}`}>{title}</h2>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
