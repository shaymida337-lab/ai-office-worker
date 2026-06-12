import type { ReactNode } from "react";
import { colors, radius, shadow, spacing, type } from "@/lib/design-tokens";

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      className={`${radius.card} ${shadow.card} ${spacing.card} text-center`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }}
    >
      {icon && <div className="mx-auto mb-3 flex justify-center" style={{ color: colors.accent }}>{icon}</div>}
      <h2 className={type.sectionTitle} style={{ color: colors.textPrimary }}>{title}</h2>
      {hint && <p className={`${type.body} mt-2`} style={{ color: colors.textSecondary }}>{hint}</p>}
      {action && <div className="mt-4 [&_a]:min-h-11 [&_button]:min-h-11">{action}</div>}
    </section>
  );
}
