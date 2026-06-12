import type { ReactNode } from "react";
import { colors, type } from "@/lib/design-tokens";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className={type.pageTitle} style={{ color: colors.textPrimary }}>{title}</h1>
        {subtitle && <p className={`${type.body} mt-2`} style={{ color: colors.textSecondary }}>{subtitle}</p>}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto [&_a]:min-h-11 [&_a]:w-full [&_button]:min-h-11 [&_button]:w-full sm:[&_a]:w-auto sm:[&_button]:w-auto">{action}</div>}
    </header>
  );
}
