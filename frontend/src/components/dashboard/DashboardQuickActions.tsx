import type { LucideIcon } from "lucide-react";
import { colors, radius, type } from "@/lib/design-tokens";

type QuickAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
};

export function DashboardQuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <section aria-label="פעולות מהירות">
      <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        פעולות מהירות
      </h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.label}
              className={`inline-flex min-h-[52px] flex-col items-center justify-center gap-2 border px-3 py-3 transition hover:brightness-[0.98] active:scale-[0.99] disabled:opacity-50 ${radius.control}`}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.borderSubtle,
                color: colors.textPrimary,
                boxShadow: "0 4px 16px rgba(15,23,42,0.05)",
              }}
            >
              <Icon className="h-5 w-5 shrink-0" style={{ color: colors.accent }} strokeWidth={2.2} />
              <span className={`${type.caption} text-center font-bold leading-5`}>{action.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export { quickActionIcons } from "./quickActionIcons";
