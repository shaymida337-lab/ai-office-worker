"use client";

import type { CrmQuickFilter } from "./types";

export function CrmFilterChips({
  value,
  onChange,
  labels,
}: {
  value: CrmQuickFilter;
  onChange: (value: CrmQuickFilter) => void;
  labels: Record<CrmQuickFilter, string>;
}) {
  const items: CrmQuickFilter[] = ["all", "leads", "customers", "pending", "followup"];

  return (
    <div
      role="tablist"
      aria-label={labels.all}
      className="flex flex-wrap gap-2.5 sm:gap-3"
    >
      {items.map((id) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
              active
                ? "border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm"
                : "border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] text-[var(--natalie-text-muted,#64748B)] hover:border-[#93C5FD] hover:text-[#1D4ED8]"
            }`}
          >
            {labels[id]}
          </button>
        );
      })}
    </div>
  );
}
