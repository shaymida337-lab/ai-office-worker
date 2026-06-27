"use client";

import type { LucideIcon } from "lucide-react";
import { CheckSquare, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { colors, radius, shadow, dashboardHome } from "@/lib/design-tokens";

export type SnapshotMetric = {
  id: string;
  label: string;
  value: string;
};

const metricIcons: Record<string, LucideIcon> = {
  in: TrendingUp,
  out: TrendingDown,
  invoices: FileText,
  tasks: CheckSquare,
  reviews: FileText,
};

const metricIconColors: Record<string, { bg: string; color: string }> = {
  in: { bg: colors.successBg, color: colors.successText },
  out: { bg: colors.warnBg, color: colors.warnText },
  invoices: { bg: colors.infoBg, color: colors.infoText },
  tasks: { bg: colors.accentSoft, color: colors.accent },
  reviews: { bg: colors.infoBg, color: colors.infoText },
};

export function SnapshotCard({ id, label, value }: SnapshotMetric) {
  const Icon = metricIcons[id] ?? FileText;
  const iconStyle = metricIconColors[id] ?? { bg: colors.bgSoft, color: colors.accent };

  return (
    <article
      className={`${radius.control} ${shadow.soft} flex h-full min-h-[88px] flex-col border p-3 md:min-h-[112px] md:p-4`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`${dashboardHome.conversation} min-w-0 flex-1 break-words font-semibold`} style={{ color: colors.textMuted }}>
          {label}
        </p>
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: iconStyle.bg, color: iconStyle.color }}
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </div>
      </div>
      <p
        className="mt-auto pt-2 text-lg font-bold leading-tight tabular-nums md:pt-3 md:text-2xl"
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
      <h2 className={`mb-3 md:mb-4 ${dashboardHome.sectionTitle}`} style={{ color: colors.textPrimary }}>
        תמונת מצב
      </h2>
      <div className="grid min-w-0 grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="min-h-[88px] animate-pulse rounded-xl border md:min-h-[112px]"
                style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
              />
            ))
          : metrics.map((metric) => (
              <SnapshotCard key={metric.id} {...metric} />
            ))}
      </div>
    </section>
  );
}
