"use client";

import type { BusinessChip, FinancialSnapshotMetric } from "@/lib/dashboard/home";
import { colors, radius, type as typography } from "@/lib/design-tokens";

const accentMap = {
  blue: { bg: colors.accentSoft, color: colors.accent },
  green: { bg: colors.successBg, color: colors.successText },
  orange: { bg: colors.warnBg, color: colors.warnText },
  purple: { bg: "#F3E8FF", color: "#6D28D9" },
} as const;

export function SnapshotCard({
  label,
  value,
  accent = "blue",
}: {
  label: string;
  value: string;
  accent?: FinancialSnapshotMetric["accent"];
}) {
  const tone = accentMap[accent];

  return (
    <article
      className={`${radius.lg} flex min-h-[148px] flex-col justify-between border p-5 md:min-h-[160px] md:p-6`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 8px 28px rgba(15,23,42,0.05)",
      }}
    >
      <p className={`${typography.caption} font-semibold leading-5`} style={{ color: colors.textMuted }}>
        {label}
      </p>
      <p
        className="mt-3 text-[32px] font-extrabold leading-none tracking-tight md:text-[36px]"
        style={{ color: tone.color }}
        title={value}
      >
        {value}
      </p>
    </article>
  );
}

export function BusinessSnapshot({
  chips,
  loading = false,
}: {
  chips: BusinessChip[];
  loading?: boolean;
}) {
  return (
    <section aria-label="תמונת מצב עסקית">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-8 w-24 shrink-0 animate-pulse rounded-full border"
                style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
              />
            ))
          : chips.map((chip) => (
              <span
                key={chip.id}
                className={`inline-flex shrink-0 items-center gap-1.5 ${radius.pill} border px-2.5 py-1.5 md:px-3`}
                style={{
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                  color: colors.textSecondary,
                }}
              >
                <span className="text-xs font-medium">{chip.label}</span>
                <span className="text-xs font-bold tabular-nums" style={{ color: colors.textPrimary }}>
                  {chip.value}
                </span>
              </span>
            ))}
      </div>
    </section>
  );
}
