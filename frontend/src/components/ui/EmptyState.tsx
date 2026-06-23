import type { ReactNode } from "react";
import { colors, radius, shadow, spacing, type } from "@/lib/design-tokens";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={`${radius.card} ${compact ? "p-4" : spacing.card} text-center`}
      style={{
        backgroundColor: colors.accentMuted,
        border: `1px dashed ${colors.border}`,
      }}
    >
      {icon && (
        <div
          className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl"
          style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
        >
          {icon}
        </div>
      )}
      <h2 className={compact ? "text-base font-bold" : type.sectionTitle} style={{ color: colors.textPrimary }}>
        {title}
      </h2>
      {hint && (
        <p className={`${type.body} mt-2 leading-6`} style={{ color: colors.textSecondary }}>
          {hint}
        </p>
      )}
      {action && <div className="mt-4 [&_a]:min-h-11 [&_button]:min-h-11">{action}</div>}
    </section>
  );
}
