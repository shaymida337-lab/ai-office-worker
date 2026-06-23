"use client";

import { colors, radius } from "@/lib/design-tokens";
import type { DocumentFilter } from "@/lib/documents/presentation";

const filters: Array<{ id: DocumentFilter; label: string }> = [
  { id: "all", label: "הכל" },
  { id: "needs_decision", label: "דורש החלטה" },
  { id: "completed", label: "הושלמו" },
  { id: "blocked", label: "חסומים" },
  { id: "duplicates", label: "כפילויות" },
  { id: "this_month", label: "החודש" },
];

export function DocumentsFilterChips({
  active,
  onChange,
}: {
  active: DocumentFilter;
  onChange: (filter: DocumentFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="סינון מסמכים">
      {filters.map((filter) => {
        const selected = active === filter.id;
        return (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(filter.id)}
            className={`min-h-[40px] ${radius.pill} border px-4 py-2 text-sm font-bold transition active:scale-[0.98]`}
            style={
              selected
                ? {
                    backgroundColor: colors.accentSoft,
                    borderColor: colors.accent,
                    color: colors.accent,
                  }
                : {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                    color: colors.textSecondary,
                  }
            }
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
