"use client";

type TimelineItem = {
  id: string;
  text: string;
  href?: string | null;
  urgency?: "urgent" | "warn" | "calm";
};

export function TodayTimeline({
  title,
  emptyText,
  items,
  onSelect,
}: {
  title: string;
  emptyText: string;
  items: TimelineItem[];
  onSelect: (href?: string | null) => void;
}) {
  return (
    <section className="rounded-2xl border border-[#DBE5F4] bg-white p-4 shadow-sm">
      <h2 className="text-base font-black text-[#0F172A]">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[#64748B]">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.href)}
                className="flex w-full items-center gap-2 rounded-xl border border-[#E6ECF8] bg-[#F8FAFF] px-3 py-2 text-start"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    item.urgency === "urgent"
                      ? "bg-red-500"
                      : item.urgency === "warn"
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                />
                <span className="text-sm font-medium text-[#1F2937]">{item.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
