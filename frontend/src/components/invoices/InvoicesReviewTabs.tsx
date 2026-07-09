"use client";

import type { InvoiceReviewStatus } from "./types";

export function InvoicesReviewTabs({
  value,
  onChange,
  onQuickNeedsReview,
  labels,
  quickFilterLabel,
}: {
  value: "all" | InvoiceReviewStatus;
  onChange: (value: "all" | InvoiceReviewStatus) => void;
  onQuickNeedsReview: () => void;
  labels: Record<"all" | InvoiceReviewStatus, string>;
  quickFilterLabel: string;
}) {
  const tabs: Array<{ value: "all" | InvoiceReviewStatus }> = [
    { value: "all" },
    { value: "approved" },
    { value: "needs_review" },
    { value: "rejected" },
  ];

  return (
    <div className="flex flex-wrap gap-2" dir="rtl" aria-label={labels.all}>
      {tabs.map((tab) => {
        const selected = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-bold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
              selected
                ? "border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm"
                : "border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] text-[var(--natalie-text-muted,#64748B)] hover:border-[#93C5FD] hover:text-[#1D4ED8]"
            }`}
            onClick={() => onChange(tab.value)}
          >
            {labels[tab.value]}
          </button>
        );
      })}
      <button
        type="button"
        className="min-h-11 rounded-full border border-[#FCD34D] bg-[#FFFBEB] px-4 py-2 text-sm font-black text-[#92400E] transition hover:bg-[#FEF3C7]"
        onClick={onQuickNeedsReview}
      >
        {quickFilterLabel}
      </button>
    </div>
  );
}
