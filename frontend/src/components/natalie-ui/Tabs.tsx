"use client";

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-2 rounded-2xl border border-[#DBE5F4] bg-[#F8FAFF] p-1"
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`rounded-xl px-3 py-2 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
              active ? "bg-white text-[#1D4ED8] shadow-sm" : "text-[#64748B] hover:text-[#1F2937]"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
