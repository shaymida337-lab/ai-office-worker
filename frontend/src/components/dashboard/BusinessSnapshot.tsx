"use client";

import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

export type SnapshotMetric = {
  id: string;
  label: string;
  value: string;
};

export function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <article
      className={`${radius.control} ${shadow.soft} flex min-h-[108px] flex-col justify-between overflow-visible border p-3.5 sm:min-h-[96px] md:min-h-[100px] md:p-4`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
      }}
    >
      <p
        className={`${typography.caption} break-words font-medium leading-snug`}
        style={{ color: colors.textMuted }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-lg font-bold leading-tight break-all tabular-nums sm:text-xl md:text-2xl"
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
    <section className="overflow-visible" aria-label="תמונת מצב עסקית">
      <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        תמונת מצב
      </h2>
      <div className="grid min-w-0 grid-cols-2 gap-2.5 overflow-visible md:grid-cols-4 md:gap-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="min-h-[108px] animate-pulse rounded-xl border sm:min-h-[96px]"
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
