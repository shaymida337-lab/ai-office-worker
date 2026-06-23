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
      className={`${radius.card} ${shadow.card} ${spacing.card} relative overflow-hidden transition hover:shadow-[0_14px_44px_rgba(15,23,42,0.10)]`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.borderSubtle}` }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${accentStyle.iconColor}22, ${accentStyle.iconColor}88, ${accentStyle.iconColor}22)` }}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className={type.kpiLabel} style={{ color: colors.textSecondary }}>
            {title}
          </div>
          {loading ? (
            <div className="mt-1 h-10 w-24 animate-pulse rounded-lg md:h-12" style={{ backgroundColor: colors.bgSoft }} />
          ) : (
            <div className={`${type.kpiValue} pt-1`} style={{ color: tone ?? colors.textPrimary }}>
              {value}
            </div>
          )}
          {subtitle && (
            <div className={type.kpiDescription} style={{ color: colors.textMuted }}>
              {subtitle}
            </div>
          )}
        </div>
        {icon && (
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl md:h-[3.25rem] md:w-[3.25rem]"
            style={{ backgroundColor: accentStyle.iconBg, color: accentStyle.iconColor }}
          >
            {icon}
          </div>
        )}
      </div>
    </section>
  );
}
