"use client";

type QuickActionItem = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export function QuickActions({
  title,
  items,
}: {
  title: string;
  items: QuickActionItem[];
}) {
  return (
    <section className="rounded-2xl border border-[#DBE5F4] bg-white p-4 shadow-sm">
      <h2 className="text-base font-black text-[#0F172A]">{title}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            disabled={item.disabled}
            className="rounded-xl border border-[#D1DCFA] bg-[#EEF2FF] px-3 py-2 text-sm font-bold text-[#1E40AF] disabled:opacity-50"
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
