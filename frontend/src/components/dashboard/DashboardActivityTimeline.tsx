"use client";

import { Check } from "lucide-react";
import type { NatalieTimelineItem } from "@/lib/natalie/types";
import { formatTimelineClock } from "@/lib/dashboard/home";
import { colors, type as typography } from "@/lib/design-tokens";

export function DashboardActivityTimeline({
  items,
  loading = false,
  compact = false,
}: {
  items: NatalieTimelineItem[];
  loading?: boolean;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-1.5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-8 animate-pulse rounded-lg border"
            style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  const visible = compact ? items.slice(0, 4) : items;

  return (
    <ol className="grid gap-0.5">
      {visible.map((item) => {
        const time = item.occurredAt ? formatTimelineClock(item.occurredAt) : "";
        return (
          <li key={item.id} className="flex items-center justify-end gap-2 py-1.5">
            <div className="min-w-0 flex-1 text-right">
              <p className={`${compact ? "text-sm leading-6" : typography.body} leading-7`} style={{ color: colors.textPrimary }}>
                {item.text}
              </p>
              {time && !compact && (
                <time className="text-xs font-medium tabular-nums" style={{ color: colors.textMuted }} dateTime={item.occurredAt}>
                  {time}
                </time>
              )}
            </div>
            <Check className="h-3.5 w-3.5 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} />
          </li>
        );
      })}
    </ol>
  );
}
