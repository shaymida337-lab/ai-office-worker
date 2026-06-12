import type { ReactNode } from "react";
import { colors, radius, shadow, spacing, type } from "@/lib/design-tokens";

export function KpiCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: ReactNode;
  value: ReactNode;
  subtitle?: ReactNode;
  tone?: string;
}) {
  return (
    <section
      className={`${radius.card} ${shadow.card} ${spacing.card}`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }}
    >
      <div className={`${type.meta} truncate font-semibold`} style={{ color: colors.textMuted }}>{title}</div>
      <div className="mt-2 text-2xl font-bold md:text-3xl" style={{ color: tone ?? colors.textPrimary }}>{value}</div>
      {subtitle && <div className={`${type.body} mt-2`} style={{ color: colors.textSecondary }}>{subtitle}</div>}
    </section>
  );
}
