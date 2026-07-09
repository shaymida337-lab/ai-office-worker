"use client";

import type { DocumentFilter } from "@/lib/documents/presentation";
import { useI18n } from "@/i18n";

const filters: DocumentFilter[] = ["all", "needs_decision", "completed", "blocked", "duplicates", "this_month"];

export function DocumentsFilterChips({
  active,
  onChange,
}: {
  active: DocumentFilter;
  onChange: (filter: DocumentFilter) => void;
}) {
  const { t } = useI18n();

  const labels: Record<DocumentFilter, string> = {
    all: t("documentsDesign.filterAll"),
    needs_decision: t("documentsDesign.filterNeedsDecision"),
    completed: t("documentsDesign.filterCompleted"),
    blocked: t("documentsDesign.filterBlocked"),
    duplicates: t("documentsDesign.filterDuplicates"),
    this_month: t("documentsDesign.filterThisMonth"),
  };

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={labels.all}>
      {filters.map((filter) => {
        const selected = active === filter;
        return (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(filter)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
              selected
                ? "border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm"
                : "border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] text-[var(--natalie-text-muted,#64748B)] hover:border-[#93C5FD] hover:text-[#1D4ED8]"
            }`}
          >
            {labels[filter]}
          </button>
        );
      })}
    </div>
  );
}
