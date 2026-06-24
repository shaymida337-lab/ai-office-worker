"use client";

import { Check } from "lucide-react";
import type { NatalieTimelineItem } from "@/lib/natalie/types";
import { formatTimelineClock } from "@/lib/dashboard/home";
import { colors } from "@/lib/design-tokens";

export function DashboardActivityTimeline({
  items,
  loading = false,
}: {
  items: NatalieTimelineItem[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section aria-label="מה נטלי עשתה היום">
        <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
          מה נטלי עשתה היום
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
      <section aria-label="מה נטלי עשתה היום">
        <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
          מה נטלי עשתה היום
        </h2>
        <p className="rounded-xl border px-4 py-3 text-sm font-medium leading-6" style={{ color: colors.textSecondary, backgroundColor: colors.bgSoft, borderColor: colors.borderSubtle }}>
          עדיין אין פעילות להציג — ברגע שאטפל במשהו, זה יופיע כאן.
        </p>
      </section>
    );
  }

  const visible = items.slice(0, 5);

  return (
    <section aria-label="מה נטלי עשתה היום">
      <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        מה נטלי עשתה היום
      </h2>
      <ol className="grid gap-0.5">
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
