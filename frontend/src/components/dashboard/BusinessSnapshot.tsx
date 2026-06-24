"use client";

import { colors, radius, type as typography } from "@/lib/design-tokens";

export type SnapshotMetric = {
  id: string;
  label: string;
  value: string;
};

export function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <article
      className={`${radius.control} flex min-h-[88px] flex-col justify-between border p-3.5 md:min-h-[96px] md:p-4`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
      }}
    >
      <p className={`${typography.caption} font-medium`} style={{ color: colors.textMuted }}>
        {label}
      </p>
      <p
        className="mt-1 text-xl font-bold leading-tight tabular-nums md:text-2xl"
        style={{ color: colors.textPrimary }}
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
  metrics: SnapshotMetric[];
  loading?: boolean;
}) {
  return (
    <section aria-label="תמונת מצב עסקית">
      <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        תמונת מצב
      </h2>
      <div className="grid min-w-0 grid-cols-2 gap-2 md:gap-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[88px] animate-pulse rounded-xl border"
                style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
              />
            ))
          : metrics.map((metric) => (
              <SnapshotCard key={metric.id} label={metric.label} value={metric.value} />
            ))}
      </div>
    </section>
  );
}
