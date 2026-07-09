"use client";

import type { ReactNode } from "react";
import { natalie } from "./tokens";

export type TimelineUrgency = "urgent" | "warn" | "calm";

export type TimelineEntry = {
  id: string;
  text: string;
  meta?: string;
  href?: string | null;
  urgency?: TimelineUrgency;
};

function urgencyDot(urgency?: TimelineUrgency) {
  if (urgency === "urgent") return "bg-red-500";
  if (urgency === "warn") return "bg-amber-500";
  return "bg-emerald-500";
}

export function Timeline({
  title,
  emptyText,
  items,
  onSelect,
}: {
  title: string;
  emptyText: string;
  items: TimelineEntry[];
  onSelect?: (href?: string | null) => void;
}) {
  return (
    <section className={`${natalie.card} p-4`}>
      <h2 className={`text-base font-black ${natalie.title}`}>{title}</h2>
      {items.length === 0 ? (
        <p className={`mt-3 text-sm ${natalie.subtitle}`}>{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {items.map((item) => (
            <li key={item.id}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(item.href)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-start ${natalie.timelineItem}`}
                >
                  <TimelineMarker urgency={item.urgency} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[#1F2937]">{item.text}</span>
                    {item.meta ? <span className={`mt-0.5 block text-xs ${natalie.subtitle}`}>{item.meta}</span> : null}
                  </span>
                </button>
              ) : (
                <div className={`flex items-center gap-2 px-3 py-2 ${natalie.timelineItem}`}>
                  <TimelineMarker urgency={item.urgency} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[#1F2937]">{item.text}</span>
                    {item.meta ? <span className={`mt-0.5 block text-xs ${natalie.subtitle}`}>{item.meta}</span> : null}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TimelineMarker({ urgency }: { urgency?: TimelineUrgency }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${urgencyDot(urgency)}`} aria-hidden />;
}

export function TimelineRow({
  children,
  urgency,
}: {
  children: ReactNode;
  urgency?: TimelineUrgency;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-[#EEF2F7] bg-[#F8FAFC] px-2 py-1 ${natalie.timelineItem}`}>
      <TimelineMarker urgency={urgency} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
