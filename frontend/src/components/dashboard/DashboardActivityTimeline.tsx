"use client";

import type { NatalieTimelineItem } from "@/lib/natalie/types";
import { formatTimelineClock } from "@/lib/dashboard/home";
import { colors, radius, type as typography } from "@/lib/design-tokens";

export function DashboardActivityTimeline({
  items,
  loading = false,
}: {
  items: NatalieTimelineItem[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section aria-label="מה עשיתי לאחרונה">
        <h2 className={`${typography.sectionTitle} mb-5 leading-snug`} style={{ color: colors.textPrimary }}>
          מה עשיתי לאחרונה
        </h2>
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className={`h-16 animate-pulse border ${radius.lg}`}
              style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section aria-label="מה עשיתי לאחרונה">
      <h2 className={`${typography.sectionTitle} mb-5 leading-snug`} style={{ color: colors.textPrimary }}>
        מה עשיתי לאחרונה
      </h2>
      <ol className="grid gap-0">
        {items.map((item, index) => {
          const time = item.occurredAt ? formatTimelineClock(item.occurredAt) : "";
          const isLast = index === items.length - 1;
          return (
            <li
              key={item.id}
              className={`relative flex items-start gap-4 py-4 ${!isLast ? "border-b" : ""}`}
              style={{ borderColor: colors.borderSubtle }}
            >
              {time && (
                <time
                  className={`w-14 shrink-0 pt-0.5 text-sm font-bold tabular-nums`}
                  style={{ color: colors.textMuted }}
                  dateTime={item.occurredAt}
                >
                  {time}
                </time>
              )}
              <p className={`${typography.body} min-w-0 flex-1 leading-7`} style={{ color: colors.textPrimary }}>
                {item.text}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
