import type { ReactNode } from "react";
import { colors, radius, spacing, type } from "@/lib/design-tokens";

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
      className={`${radius.card} ${compact ? "p-5" : spacing.card} text-center`}
      style={{
        backgroundColor: colors.accentMuted,
        border: `1px dashed ${colors.border}`,
      }}
    >
      {icon && (
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl"
          style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
        >
          {icon}
        </div>
      )}
      <h2 className={compact ? type.cardTitle : type.sectionTitle} style={{ color: colors.textPrimary }}>
        {title}
      </h2>
      {hint && (
        <p className={`${type.body} mt-2`} style={{ color: colors.textSecondary }}>
          {hint}
        </p>
      )}
      {action && <div className="mt-5 [&_a]:min-h-[52px] [&_button]:min-h-[52px]">{action}</div>}
    </section>
  );
}
