"use client";

import { Check } from "lucide-react";
import type { NatalieTimelineItem } from "@/lib/natalie/types";
import { formatTimelineClock } from "@/lib/dashboard/home";
import { colors } from "@/lib/design-tokens";

const EMPTY_MESSAGE =
  "עדיין אין פעילות להצגה — נטלי תציג כאן עדכונים ברגע שהעסק יתחיל לזוז.";

export function DashboardActivityTimeline({
  items,
  loading = false,
}: {
  items: NatalieTimelineItem[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section aria-label="פעילות אחרונה">
        <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
          פעילות אחרונה
        </h2>
        <div className="grid gap-1.5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded-lg border"
              style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section aria-label="פעילות אחרונה">
        <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
          פעילות אחרונה
        </h2>
        <p
          className="rounded-xl border px-4 py-3 text-sm font-medium leading-6"
          style={{ color: colors.textSecondary, backgroundColor: colors.bgSoft, borderColor: colors.borderSubtle }}
        >
          {EMPTY_MESSAGE}
        </p>
      </section>
    );
  }

  const visible = items.slice(0, 6);

  return (
    <section aria-label="פעילות אחרונה">
      <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        פעילות אחרונה
      </h2>
      <ol className="grid gap-1 md:grid-cols-2 md:gap-2">
        {visible.map((item) => {
          const time = item.occurredAt ? formatTimelineClock(item.occurredAt) : "";
          return (
            <li
              key={item.id}
              className="flex items-start justify-end gap-2.5 rounded-lg border px-3 py-2.5"
              style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            >
              <div className="min-w-0 flex-1 text-right">
                <p className="text-sm font-medium leading-6" style={{ color: colors.textPrimary }}>
                  {item.text}
                </p>
                {time && (
                  <time className="text-xs tabular-nums" style={{ color: colors.textMuted }} dateTime={item.occurredAt}>
                    {time}
                  </time>
                )}
              </div>
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
