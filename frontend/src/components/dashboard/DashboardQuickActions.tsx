import type { LucideIcon } from "lucide-react";
import { colors, radius, shadow, dashboardHome } from "@/lib/design-tokens";

export const DASHBOARD_QUICK_ACTION_LABELS = [
  "שאל את נטלי",
  "סרוק מיילים",
  "העלה מסמך",
] as const;

export type DashboardQuickAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
};

export function DashboardQuickActions({ actions }: { actions: DashboardQuickAction[] }) {
  const visibleActions = actions.slice(0, 3);

  return (
    <section
      className="dashboard-fade-in min-w-0"
      aria-label="פעולות מהירות"
      data-testid="dashboard-quick-actions"
    >
      <h2 className={`mb-2.5 ${dashboardHome.sectionTitle}`} style={{ color: colors.textPrimary }}>
        פעולות מהירות
      </h2>
      <div
        data-testid="dashboard-quick-actions-grid"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3"
      >
        {visibleActions.map((action, index) => {
          const Icon = action.icon;
          const isThirdOnMobile = index === 2;

          return (
            <button
              key={action.id}
              type="button"
              data-testid={`dashboard-quick-action-${action.id}`}
              onClick={action.onClick}
              disabled={action.disabled}
              aria-label={action.label}
              className={`${radius.control} ${shadow.soft} inline-flex min-h-11 flex-col items-center justify-center gap-2 border px-3 py-3 transition duration-200 hover:brightness-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[52px] md:py-3.5 ${
                isThirdOnMobile ? "col-span-2 sm:col-span-1" : ""
              }`}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.borderSubtle,
                color: colors.textPrimary,
                outlineColor: colors.accent,
              }}
            >
              {Icon ? (
                <Icon
                  className="h-5 w-5 shrink-0"
                  style={{ color: colors.accent }}
                  strokeWidth={2.2}
                  aria-hidden
                />
              ) : null}
              <span className={`${dashboardHome.actionLabel} text-center leading-snug`}>{action.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export { quickActionIcons } from "./quickActionIcons";
