"use client";

import type { ReactNode } from "react";
import { natalie } from "./tokens";

export function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <article className={`${natalie.card} p-4`}>
      <p className={`text-xs font-semibold ${natalie.subtitle}`}>{label}</p>
      <p className={`mt-2 text-xl font-black ${natalie.title}`}>{value}</p>
    </article>
  );
}

export function SectionCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${natalie.card} p-4 ${className}`}>
      <h2 className={`text-base font-black ${natalie.title}`}>{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
