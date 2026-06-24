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
      <h2 className={`${typography.caption} mb-3 font-semibold uppercase tracking-wide`} style={{ color: colors.textMuted }}>
        תמונת מצב
      </h2>

      {loading ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-28 animate-pulse rounded-full border"
              style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className={`inline-flex items-center gap-2 ${radius.pill} border px-3.5 py-2`}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.borderSubtle,
                color: colors.textSecondary,
              }}
            >
              <span className={`${typography.caption} font-semibold`}>{chip.label}</span>
              <span className={`${typography.caption} font-bold tabular-nums`} style={{ color: colors.textPrimary }}>
                {chip.value}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
