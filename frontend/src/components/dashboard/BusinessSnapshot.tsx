"use client";

import type { FinancialSnapshotMetric } from "@/lib/dashboard/home";
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
  metrics,
  loading = false,
}: {
  metrics: FinancialSnapshotMetric[];
  loading?: boolean;
}) {
  return (
    <section aria-label="תמונת מצב עסקית">
      <h2 className={`${typography.sectionTitle} mb-5 leading-snug`} style={{ color: colors.textPrimary }}>
        תמונת מצב עסקית
      </h2>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[148px] animate-pulse rounded-2xl border md:h-[160px]"
              style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          {metrics.map((metric) => (
            <SnapshotCard key={metric.id} label={metric.label} value={metric.value} accent={metric.accent} />
          ))}
        </div>
      )}
    </section>
  );
}
