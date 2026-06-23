import type { ReactNode } from "react";
import { colors, type } from "@/lib/design-tokens";

export function DashboardSectionHeader({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-1">
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-3">
          {icon && (
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow-sm"
              style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
            >
              {icon}
            </span>
          )}
          <h2 className={type.sectionHeader} style={{ color: colors.textPrimary }}>
            {title}
          </h2>
        </div>
        {hint && (
          <p className={`${type.body} max-w-3xl pr-1 leading-7`} style={{ color: colors.textSecondary }}>
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
