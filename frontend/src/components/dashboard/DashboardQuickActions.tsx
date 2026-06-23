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
    <section className="border-t pt-6" style={{ borderColor: colors.borderSubtle }} aria-label="פעולות מהירות">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.label}
              className={`inline-flex min-h-[44px] items-center gap-2 border px-3 py-2 transition hover:bg-white disabled:opacity-50 ${radius.pill}`}
              style={{
                backgroundColor: colors.bgSoft,
                borderColor: colors.borderSubtle,
                color: colors.textSecondary,
              }}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              <span className={`${type.caption} font-semibold`}>{action.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export { quickActionIcons } from "./quickActionIcons";
