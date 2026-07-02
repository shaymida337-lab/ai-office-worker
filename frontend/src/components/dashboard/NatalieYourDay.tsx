"use client";

import { CalendarClock, CheckCircle2, CircleDollarSign, FileText, ListTodo } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { colors, radius, shadow, dashboardHome } from "@/lib/design-tokens";
import type { YourDayItem } from "@/lib/dashboard/yourDay";

const urgencyStyles = {
  urgent: { border: colors.dangerBorder, bg: colors.dangerBg, text: colors.dangerText },
  warn: { border: colors.warnBorder, bg: colors.warnBg, text: colors.warnText },
  calm: { border: colors.successBorder, bg: colors.successBg, text: colors.successText },
};

const itemIcons: Record<string, LucideIcon> = {
  appt: CalendarClock,
  payments: CircleDollarSign,
  documents: FileText,
  tasks: ListTodo,
  "all-clear": CheckCircle2,
};

function iconForItem(id: string) {
  if (id.startsWith("appt-")) return itemIcons.appt;
  if (id.startsWith("payments")) return itemIcons.payments;
  if (id === "documents") return itemIcons.documents;
  if (id === "tasks") return itemIcons.tasks;
  return itemIcons["all-clear"];
}

export function NatalieYourDay({
  items,
  loading = false,
}: {
  items: YourDayItem[];
  loading?: boolean;
}) {
  return (
    <section id="natalie-decisions" className="dashboard-fade-in" aria-label="היום שלך">
      <h2 className={dashboardHome.sectionTitle} style={{ color: colors.textPrimary }}>
        היום שלך
      </h2>
      <p className={`mt-1 ${dashboardHome.sectionSubtitle}`} style={{ color: colors.textSecondary }}>
        מה מחכה לך עכשיו
      </p>

      <div
        className={`${radius.card} ${shadow.soft} mt-3 border p-3 md:p-4`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      >
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="dashboard-shimmer h-12 rounded-xl" style={{ backgroundColor: colors.bgSoft }} />
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => {
              const style = urgencyStyles[item.urgency];
              const Icon = iconForItem(item.id);
              return (
                <li
                  key={item.id}
                  className={`dashboard-chip-in flex items-center gap-3 rounded-xl border px-3 py-3 md:px-4`}
                  style={{
                    backgroundColor: style.bg,
                    borderColor: style.border,
                    animationDelay: `${index * 50}ms`,
                  }}
                >
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                    style={{ backgroundColor: colors.surface, color: style.text }}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.2} />
                  </div>
                  <p className={`${dashboardHome.listItem} flex-1 text-right`} style={{ color: colors.textPrimary }}>
                    {item.text}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
