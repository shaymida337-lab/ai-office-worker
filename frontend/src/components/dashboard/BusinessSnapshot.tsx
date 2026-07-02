"use client";

import type { LucideIcon } from "lucide-react";
import { CheckSquare, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { colors, radius, shadow, dashboardHome } from "@/lib/design-tokens";
import type { DashboardKpiId } from "@/lib/dashboard/dashboardMetrics";

export type SnapshotMetric = {
  id: DashboardKpiId | string;
  label: string;
  value: string;
};

const metricIcons: Record<DashboardKpiId, LucideIcon> = {
  in: TrendingUp,
  out: TrendingDown,
  documents: FileText,
  tasks: CheckSquare,
};

const metricIconColors: Record<DashboardKpiId, { bg: string; color: string }> = {
  in: { bg: colors.successBg, color: colors.successText },
  out: { bg: colors.warnBg, color: colors.warnText },
  documents: { bg: colors.infoBg, color: colors.infoText },
  tasks: { bg: colors.accentSoft, color: colors.accent },
};

function isDashboardKpiId(id: string): id is DashboardKpiId {
  return id === "in" || id === "out" || id === "documents" || id === "tasks";
}

export function SnapshotCard({ id, label, value }: SnapshotMetric) {
  const kpiId = isDashboardKpiId(id) ? id : "documents";
  const Icon = metricIcons[kpiId];
  const iconStyle = metricIconColors[kpiId];

  return (
    <article
      data-testid={`dashboard-kpi-${kpiId}`}
      aria-label={`${label}: ${value}`}
      className={`${radius.control} ${shadow.card} flex h-full min-h-[84px] items-center gap-3 border p-3.5 md:p-4`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
      }}
    >
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: iconStyle.bg, color: iconStyle.color }}
        aria-hidden
      >
        <Icon className="h-4 w-4" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1 text-right">
        <p className={`${dashboardHome.conversation} truncate font-medium`} style={{ color: colors.textMuted }}>
          {label}
        </p>
        <p
          className="truncate text-lg font-bold leading-tight tabular-nums"
          style={{ color: colors.textPrimary }}
          title={value}
        >
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
    <section className="dashboard-fade-in" aria-label="תמונת מצב עסקית" data-testid="dashboard-kpi-section">
      <h2 className={`mb-2.5 ${dashboardHome.sectionTitle}`} style={{ color: colors.textPrimary }}>
        תמונת מצב
      </h2>
      <div
        data-testid="dashboard-kpi-grid"
        className="grid min-w-0 grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3"
      >
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                data-testid={`dashboard-kpi-skeleton-${i}`}
                className={`dashboard-shimmer ${radius.control} min-h-[84px] border`}
                style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
              />
            ))
          : metrics.slice(0, 4).map((metric) => (
              <SnapshotCard key={metric.id} {...metric} />
            ))}
      </div>
    </section>
  );
}
