"use client";

import { colors, type as typography } from "@/lib/design-tokens";
import {
  formatReviewQueueHeadline,
  type DocumentReviewItem,
} from "@/lib/documents/presentation";
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
  const visible = items.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, totalCount - visible.length);

  if (items.length === 0) return null;

  return (
    <section className="grid gap-4" aria-label="תור החלטות">
      <div>
        <h2 className={`${typography.sectionTitle} leading-snug`} style={{ color: colors.textPrimary }}>
          מה דורש את ההחלטה שלך
        </h2>
        <p className={`${typography.body} mt-1`} style={{ color: colors.textSecondary }}>
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
        <p className={`${typography.body} text-center font-semibold`} style={{ color: colors.textSecondary }}>
          ועוד {hidden} {hidden === 1 ? "מסמך" : "מסמכים"} בתור
        </p>
      )}
    </section>
  );
}
