"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { NatalieTimelineItem } from "@/lib/natalie/types";
import { formatTimelineClock } from "@/lib/dashboard/home";
import { colors, radius, shadow, dashboardHome } from "@/lib/design-tokens";

const EMPTY_MESSAGE =
  "ברגע שאסיים משהו חדש בשבילך, אראה את זה כאן.";

function TimelineCard({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${radius.card} ${shadow.soft} border p-3.5 md:p-4`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
    >
      {children}
    </div>
  );
}

export function DashboardActivityTimeline({
  items,
  loading = false,
}: {
  items: NatalieTimelineItem[];
  loading?: boolean;
}) {
  const header = (
    <h2 className={dashboardHome.sectionTitle} style={{ color: colors.textPrimary }}>
      פעילות אחרונה
    </h2>
  );

  if (loading) {
    return (
      <section className="dashboard-fade-in flex h-auto min-w-0 flex-col overflow-visible" aria-label="פעילות אחרונה">
        {header}
        <TimelineCard>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="dashboard-shimmer h-12 rounded-xl" style={{ backgroundColor: colors.bgSoft }} />
            ))}
          </div>
        </TimelineCard>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="dashboard-fade-in flex h-auto min-w-0 flex-col overflow-visible" aria-label="פעילות אחרונה">
        {header}
        <TimelineCard>
          <div className="flex min-h-[120px] items-center">
            <p className={dashboardHome.conversation} style={{ color: colors.textSecondary }}>
              {EMPTY_MESSAGE}
            </p>
          </div>
        </TimelineCard>
      </section>
    );
  }

  const visible = items.slice(0, 6);

  return (
    <section className="dashboard-fade-in flex h-auto min-w-0 flex-col overflow-visible" aria-label="פעילות אחרונה">
      {header}
      <TimelineCard>
        <ol className="grid gap-2">
          {visible.map((item) => {
            const time = item.occurredAt ? formatTimelineClock(item.occurredAt) : "";
            return (
              <li
                key={item.id}
                className="flex items-start justify-end gap-2.5 rounded-xl px-3 py-2.5"
                style={{ backgroundColor: colors.bgSoft }}
              >
                <div className="min-w-0 flex-1 text-right">
                  <p className={`${dashboardHome.conversation} leading-snug`} style={{ color: colors.textPrimary }}>
                    {item.text}
                  </p>
                  {time && (
                    <time
                      className="text-xs tabular-nums leading-5"
                      style={{ color: colors.textMuted }}
                      dateTime={item.occurredAt}
                    >
                      {time}
                    </time>
                  )}
                </div>
                <Check className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} aria-hidden />
              </li>
            );
          })}
        </ol>
      </TimelineCard>
    </section>
  );
}
