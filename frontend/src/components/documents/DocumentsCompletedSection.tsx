"use client";

import { CheckCircle2 } from "lucide-react";
import { colors, radius, type as typography } from "@/lib/design-tokens";
import {
  documentReviewAmountLabel,
  documentTypeLabel,
  formatDocumentDate,
  type DocumentReviewItem,
} from "@/lib/documents/presentation";

export function DocumentsCompletedSection({
  items,
  defaultOpen = false,
}: {
  items: DocumentReviewItem[];
  defaultOpen?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <details
      className={`${radius.lg} border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      open={defaultOpen}
    >
      <summary
        className="cursor-pointer list-none px-5 py-5 md:px-6"
        style={{ color: colors.textPrimary }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} />
          <span className={`${typography.cardTitle}`}>
            היום כבר סיימתי {items.length} {items.length === 1 ? "מסמך" : "מסמכים"}
          </span>
        </div>
      </summary>
      <ul className="grid gap-2 border-t px-5 pb-5 pt-3 md:px-6" style={{ borderColor: colors.borderSubtle }}>
        {items.slice(0, 12).map((item) => (
          <li
            key={item.id}
            className={`flex flex-wrap items-center justify-between gap-2 ${radius.control} px-4 py-3`}
            style={{ backgroundColor: colors.successBg }}
          >
            <span className={`${typography.body} font-semibold`} style={{ color: colors.successText }}>
              {item.supplierName?.trim() || item.sender?.trim() || "מסמך"}
            </span>
            <span className={`${typography.caption} font-semibold tabular-nums`} style={{ color: colors.textMuted }}>
              {documentReviewAmountLabel(item)} · {documentTypeLabel(item.documentType)} ·{" "}
              {formatDocumentDate(item.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
