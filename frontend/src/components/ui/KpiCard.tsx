import type { ReactNode } from "react";
import { colors, kpiAccentStyles, radius, shadow, spacing, type, type KpiAccent } from "@/lib/design-tokens";

export function KpiCard({
  title,
  value,
  subtitle,
  tone,
  icon,
  accent = "blue",
  loading = false,
}: {
  title: ReactNode;
  value: ReactNode;
  subtitle?: ReactNode;
  tone?: string;
  icon?: ReactNode;
  accent?: KpiAccent;
  loading?: boolean;
}) {
  const accentStyle = kpiAccentStyles[accent];

  return (
    <section
      className={`${radius.card} ${shadow.card} ${spacing.card} relative overflow-hidden transition hover:shadow-[0_12px_36px_rgba(20,40,90,0.08)]`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.borderSubtle}` }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${accentStyle.iconColor}22, ${accentStyle.iconColor}88, ${accentStyle.iconColor}22)` }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className={`${type.meta} font-semibold leading-5`} style={{ color: colors.textMuted }}>
            {title}
          </div>
          {loading ? (
            <div className="mt-3 h-9 w-20 animate-pulse rounded-lg" style={{ backgroundColor: colors.bgSoft }} />
          ) : (
            <div className={`${type.kpi} mt-2 tabular-nums`} style={{ color: tone ?? colors.textPrimary }}>
              {value}
            </div>
          )}
          {subtitle && (
            <div className={`${type.body} mt-2 leading-5`} style={{ color: colors.textSecondary }}>
              {subtitle}
            </div>
          )}
        </div>
        {icon && (
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
            style={{ backgroundColor: accentStyle.iconBg, color: accentStyle.iconColor }}
          >
            {icon}
          </div>
        )}
      </div>
    </section>
  );
}
