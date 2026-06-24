"use client";

import { Check } from "lucide-react";
import type { NatalieTimelineItem } from "@/lib/natalie/types";
import { formatTimelineClock } from "@/lib/dashboard/home";
import { colors, type as typography } from "@/lib/design-tokens";

export function DashboardActivityTimeline({
  items,
  loading = false,
}: {
  items: NatalieTimelineItem[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section aria-label="מה כבר סיימתי עבורך">
        <h2 className={`${typography.sectionTitle} mb-4 leading-snug`} style={{ color: colors.textPrimary }}>
          מה כבר סיימתי עבורך
        </h2>
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
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

  if (items.length === 0) return null;

  return (
    <section aria-label="מה כבר סיימתי עבורך">
      <h2 className={`${typography.sectionTitle} mb-4 leading-snug`} style={{ color: colors.textPrimary }}>
        מה כבר סיימתי עבורך
      </h2>
      <ol className="grid gap-1">
        {items.map((item) => {
          const time = item.occurredAt ? formatTimelineClock(item.occurredAt) : "";
          return (
            <li key={item.id} className="flex items-start justify-end gap-3 py-2">
              <div className="min-w-0 flex-1 text-right">
                <p className={`${typography.body} leading-7`} style={{ color: colors.textPrimary }}>
                  {item.text}
                </p>
                {time && (
                  <time
                    className="text-xs font-medium tabular-nums"
                    style={{ color: colors.textMuted }}
                    dateTime={item.occurredAt}
                  >
                    {time}
                  </time>
                )}
              </div>
              <Check
                className="mt-1 h-4 w-4 shrink-0"
                style={{ color: colors.successText }}
                strokeWidth={2.5}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
