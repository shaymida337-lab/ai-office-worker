import type { ReactNode } from "react";
import { colors, radius, type } from "@/lib/design-tokens";

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
      className={`mb-6 ${radius.card} border p-5 md:mb-8 md:p-6`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 8px 30px rgba(20,40,90,0.05)",
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {badge && <div className="mb-2">{badge}</div>}
          <h1 className={type.pageTitle} style={{ color: colors.textPrimary }}>
            {title}
          </h1>
          {subtitle && (
            <p className={`${type.body} mt-2 max-w-2xl text-base leading-7 md:text-[15px]`} style={{ color: colors.textSecondary }}>
              {subtitle}
            </p>
          )}
        </div>
        {action && (
          <div className="w-full shrink-0 sm:w-auto [&_a]:min-h-11 [&_a]:w-full [&_button]:min-h-11 [&_button]:w-full sm:[&_a]:w-auto sm:[&_button]:w-auto">
            {action}
          </div>
        )}
      </div>
    </header>
  );
}
