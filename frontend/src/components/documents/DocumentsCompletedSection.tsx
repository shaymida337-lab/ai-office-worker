"use client";

import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/natalie-ui";
import { useI18n } from "@/i18n";
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
  const { t } = useI18n();

  if (items.length === 0) return null;

  const title =
    items.length === 1
      ? t("documentsDesign.completedTodayOne")
      : t("documentsDesign.completedToday", { count: String(items.length) });

  return (
    <Card padding="none" className="overflow-hidden">
      <details open={defaultOpen}>
        <summary className="cursor-pointer list-none px-5 py-5 text-[var(--natalie-text-primary,#0F172A)] md:px-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[#065F46]" strokeWidth={2.5} />
            <span className="text-lg font-black">{title}</span>
          </div>
        </summary>
        <ul className="grid gap-2 border-t border-[var(--natalie-border,#D9E2F2)] px-5 pb-5 pt-3 md:px-6">
          {items.slice(0, 12).map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#ECFDF5] px-4 py-3"
            >
              <span className="text-base font-semibold text-[#065F46]">
                {item.supplierName?.trim() || item.sender?.trim() || "מסמך"}
              </span>
              <span className="text-sm font-semibold tabular-nums text-[var(--natalie-text-muted,#64748B)]">
                {documentReviewAmountLabel(item)} · {documentTypeLabel(item.documentType)} ·{" "}
                {formatDocumentDate(item.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
