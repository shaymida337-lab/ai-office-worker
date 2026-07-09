"use client";

import {
  formatReviewQueueHeadline,
  type DocumentReviewItem,
} from "@/lib/documents/presentation";
import { useI18n } from "@/i18n";
import { DocumentDecisionCard } from "./DocumentDecisionCard";

const MAX_VISIBLE = 5;

export function DocumentDecisionQueue({
  items,
  totalCount,
  exitingIds,
  updatingId,
  onApprove,
  onOpen,
  onRemove,
}: {
  items: DocumentReviewItem[];
  totalCount: number;
  exitingIds: Set<string>;
  updatingId: string | null;
  onApprove: (id: string, supplierName: string) => void;
  onOpen: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const visible = items.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, totalCount - visible.length);

  if (items.length === 0) return null;

  return (
    <section className="grid gap-4" aria-label={t("documentsDesign.queueTitle")}>
      <div>
        <h2 className="text-xl font-black leading-snug text-[var(--natalie-text-primary,#0F172A)]">
          {t("documentsDesign.queueTitle")}
        </h2>
        <p className="mt-1 text-base text-[var(--natalie-text-muted,#64748B)]">
          {formatReviewQueueHeadline(visible.length, totalCount)}
        </p>
      </div>

      <div className="grid gap-4">
        {visible.map((item) => (
          <DocumentDecisionCard
            key={item.id}
            item={item}
            exiting={exitingIds.has(item.id)}
            updating={updatingId === item.id}
            onApprove={onApprove}
            onOpen={onOpen}
            onRemove={onRemove}
          />
        ))}
      </div>

      {hidden > 0 && (
        <p className="text-center text-base font-semibold text-[var(--natalie-text-muted,#64748B)]">
          ועוד {hidden} {hidden === 1 ? "מסמך" : "מסמכים"} בתור
        </p>
      )}
    </section>
  );
}
