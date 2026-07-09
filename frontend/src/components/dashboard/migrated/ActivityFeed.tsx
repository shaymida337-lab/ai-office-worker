"use client";

import { SectionCard } from "@/components/natalie-ui";

type ActivityItem = {
  id: string;
  text: string;
  occurredAt: string;
};

export function ActivityFeed({
  title,
  emptyText,
  items,
}: {
  title: string;
  emptyText: string;
  items: ActivityItem[];
}) {
  return (
    <SectionCard title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-[#64748B]">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-[#E6ECF8] bg-[#F8FAFF] px-3 py-2">
              <p className="text-sm font-medium text-[#1F2937]">{item.text}</p>
              <p className="mt-1 text-xs text-[#64748B]">{formatDateTime(item.occurredAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
