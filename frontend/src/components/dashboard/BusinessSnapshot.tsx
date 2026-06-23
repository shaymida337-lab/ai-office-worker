"use client";

import { colors, radius, type as typography } from "@/lib/design-tokens";

type SnapshotAccent = "blue" | "green" | "orange" | "purple";

const accentMap: Record<SnapshotAccent, { bg: string; color: string }> = {
  blue: { bg: colors.accentSoft, color: colors.accent },
  green: { bg: colors.successBg, color: colors.successText },
  orange: { bg: colors.warnBg, color: colors.warnText },
  purple: { bg: "#F3E8FF", color: "#6D28D9" },
};

export function SnapshotCard({
  label,
  value,
  hint,
  accent = "blue",
}: {
  label: string;
  value: string;
  hint: string;
  accent?: SnapshotAccent;
}) {
  const tone = accentMap[accent];

  return (
    <article
      className={`${radius.lg} flex min-h-[132px] min-w-[148px] flex-col justify-between border p-4 snap-start`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 6px 24px rgba(15,23,42,0.05)",
      }}
    >
      <p className={`${typography.caption} font-semibold leading-5`} style={{ color: colors.textMuted }}>
        {label}
      </p>
      <p
        className={`${typography.kpiValue} mt-2 truncate`}
        style={{ color: tone.color }}
        title={value}
      >
        {value}
      </p>
      <p className={`${typography.caption} mt-2 line-clamp-2 leading-5`} style={{ color: colors.textSecondary }}>
        {hint}
      </p>
    </article>
  );
}

export function BusinessSnapshot({
  metrics,
  loading = false,
}: {
  metrics: Array<{ id: string; label: string; value: string; hint: string; accent: SnapshotAccent }>;
  loading?: boolean;
}) {
  return (
    <section aria-label="תמונת מצב עסקית">
      <h2 className={`${typography.sectionTitle} mb-4 leading-snug`} style={{ color: colors.textPrimary }}>
        מצב העסק היום
      </h2>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[132px] animate-pulse rounded-2xl border"
              style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="-mx-1 flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none md:mx-0 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
            {metrics.map((metric) => (
              <SnapshotCard key={metric.id} {...metric} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
