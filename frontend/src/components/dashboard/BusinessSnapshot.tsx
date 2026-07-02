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
      className={`${radius.control} flex min-h-[76px] items-center gap-3 border p-3`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
      }}
    >
      <div
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: iconStyle.bg, color: iconStyle.color }}
      >
        <Icon className="h-4 w-4" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1 text-right">
        <p className={`${dashboardHome.conversation} font-medium`} style={{ color: colors.textMuted }}>
          {label}
        </p>
        <p className="text-lg font-bold leading-tight tabular-nums" style={{ color: colors.textPrimary }} title={value}>
          {value}
        </p>
      </div>
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
    <section className="dashboard-fade-in" aria-label="תמונת מצב עסקית">
      <h2 className={`mb-2.5 ${dashboardHome.sectionTitle}`} style={{ color: colors.textPrimary }}>
        תמונת מצב
      </h2>
      <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="dashboard-shimmer min-h-[76px] rounded-xl border"
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
