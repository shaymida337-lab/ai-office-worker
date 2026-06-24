"use client";

import { Check } from "lucide-react";
import type { NatalieTimelineItem } from "@/lib/natalie/types";
import { formatTimelineClock } from "@/lib/dashboard/home";
import { colors, radius, shadow } from "@/lib/design-tokens";

const EMPTY_MESSAGE =
  "עדיין אין פעילות להצגה — נטלי תציג כאן עדכונים ברגע שהעסק יתחיל לזוז.";

export function DashboardActivityTimeline({
  items,
  loading = false,
}: {
  items: NatalieTimelineItem[];
  loading?: boolean;
}) {
  const header = (
    <h2 className="text-base font-bold leading-snug md:text-lg" style={{ color: colors.textPrimary }}>
      פעילות אחרונה
    </h2>
  );

  if (loading) {
    return (
      <section className="flex h-full min-w-0 flex-col" aria-label="פעילות אחרונה">
        {header}
        <div className={`${radius.card} ${shadow.soft} mt-3 flex-1 space-y-2 border p-3`} style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-lg" style={{ backgroundColor: colors.bgSoft }} />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="flex h-full min-w-0 flex-col" aria-label="פעילות אחרונה">
        {header}
        <div
          className={`${radius.card} ${shadow.soft} mt-3 flex min-h-[148px] flex-1 items-center border p-4`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          <p className="text-sm font-medium leading-7" style={{ color: colors.textSecondary }}>
            {EMPTY_MESSAGE}
          </p>
        </div>
      </section>
    );
  }

  const visible = items.slice(0, 6);

  return (
    <section className="flex h-full min-w-0 flex-col" aria-label="פעילות אחרונה">
      {header}
      <div
        className={`${radius.card} ${shadow.soft} mt-3 flex-1 border p-3 md:p-4`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      >
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
                  <p className="text-sm font-medium leading-6" style={{ color: colors.textPrimary }}>
                    {item.text}
                  </p>
                  {time && (
                    <time className="text-xs tabular-nums leading-5" style={{ color: colors.textMuted }} dateTime={item.occurredAt}>
                      {time}
                    </time>
                  )}
                </div>
                <Check className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
