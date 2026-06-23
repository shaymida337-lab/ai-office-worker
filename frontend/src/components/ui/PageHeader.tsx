import type { ReactNode } from "react";
import { colors, radius, spacing, type } from "@/lib/design-tokens";

export function PageHeader({
  title,
  subtitle,
  action,
  badge,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header
      className={`mb-8 md:mb-10 ${radius.card} border ${spacing.card}`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 12px 40px rgba(15,23,42,0.07)",
      }}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-3">
          {badge && <div>{badge}</div>}
          <h1 className={type.h1} style={{ color: colors.textPrimary }}>
            {title}
          </h1>
          {subtitle && (
            <p className={`${type.subtitle} max-w-2xl`} style={{ color: colors.textSecondary }}>
              {subtitle}
            </p>
          )}
        </div>
        {action && (
          <div className="w-full shrink-0 sm:w-auto [&_a]:min-h-[52px] [&_a]:w-full [&_button]:min-h-[52px] [&_button]:w-full sm:[&_a]:w-auto sm:[&_button]:w-auto">
            {action}
          </div>
        )}
      </div>
    </header>
  );
}
