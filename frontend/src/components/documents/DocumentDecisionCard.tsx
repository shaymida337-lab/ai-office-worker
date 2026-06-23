"use client";

import { ExternalLink, FileText } from "lucide-react";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";
import {
  drivePreviewUrl,
  formatDocumentDate,
  presentDocument,
  sourceLabel,
  type DocumentReviewItem,
} from "@/lib/documents/presentation";

export function DocumentDecisionCard({
  item,
  exiting = false,
  updating = false,
  onApprove,
  onOpen,
  onRemove,
}: {
  item: DocumentReviewItem;
  exiting?: boolean;
  updating?: boolean;
  onApprove: (id: string) => void;
  onOpen: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  const view = presentDocument(item);
  const previewUrl = drivePreviewUrl(item.driveFileUrl);

  function handlePrimary() {
    if (view.primaryLabel === "אשרי") {
      onApprove(item.id);
      return;
    }
    if (item.driveFileUrl) {
      onOpen(item.driveFileUrl);
      return;
    }
    onApprove(item.id);
  }

  function handleSecondary() {
    if (item.driveFileUrl) {
      onOpen(item.driveFileUrl);
    }
  }

  return (
    <article
      className={`${radius.lg} border overflow-hidden transition-all duration-300 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 ${
        exiting ? "pointer-events-none translate-x-4 opacity-0 scale-[0.98]" : "opacity-100"
      }`}
      style={{
        backgroundColor: colors.surface,
        borderColor: view.isBlocked ? colors.warnBorder : colors.borderSubtle,
        boxShadow: "0 10px 40px rgba(15,23,42,0.06)",
      }}
    >
      <div className="grid gap-0 lg:grid-cols-2">
        <div
          className="relative min-h-[220px] border-b lg:min-h-[320px] lg:border-b-0 lg:border-l"
          style={{ backgroundColor: colors.bgSoft, borderColor: colors.borderSubtle }}
        >
          {previewUrl ? (
            <iframe
              title={`תצוגה מקדימה — ${view.supplier}`}
              src={previewUrl}
              className="h-full min-h-[220px] w-full lg:min-h-[320px]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center lg:min-h-[320px]">
              <span
                className="grid h-14 w-14 place-items-center rounded-2xl"
                style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
              >
                <FileText className="h-7 w-7" strokeWidth={2} />
              </span>
              <p className={`${typography.body} font-semibold`} style={{ color: colors.textSecondary }}>
                {item.fileName ?? "אין תצוגה מקדימה"}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`${radius.pill} px-2.5 py-1 text-xs font-bold`}
              style={{ backgroundColor: colors.warnBg, color: colors.warnText }}
            >
              {view.typeLabel}
            </span>
            <span className={`${typography.caption} font-semibold`} style={{ color: colors.textMuted }}>
              {sourceLabel(item.source)} · {formatDocumentDate(item.createdAt)}
            </span>
          </div>

          <div>
            <h2 className={`${typography.cardTitle} break-words`} style={{ color: colors.textPrimary }}>
              {view.supplier}
            </h2>
            <p className={`${typography.kpiValue} mt-2 text-[28px] md:text-[32px]`} style={{ color: colors.accent }}>
              {view.amountLabel}
            </p>
            <p className={`${typography.caption} mt-1 font-semibold`} style={{ color: colors.textMuted }}>
              {view.documentTypeLabel}
            </p>
          </div>

          <p className={`${typography.body} leading-7`} style={{ color: colors.textSecondary }}>
            {view.reason}
          </p>

          <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={updating || exiting}
              onClick={handlePrimary}
              className={`${radius.control} ${button.primary} w-full sm:w-auto`}
              style={{
                backgroundColor: colors.accent,
                border: `1px solid ${colors.accent}`,
                color: colors.surface,
              }}
            >
              {updating ? "מעדכנת..." : view.primaryLabel}
            </button>
            {item.driveFileUrl && (
              <button
                type="button"
                disabled={updating || exiting}
                onClick={handleSecondary}
                className={`${radius.control} ${button.secondary} inline-flex w-full items-center justify-center gap-2 sm:w-auto`}
                style={{
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  color: colors.textSecondary,
                }}
              >
                <ExternalLink className="h-4 w-4" />
                {view.secondaryLabel}
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={updating || exiting}
            onClick={() => onRemove(item.id)}
            className={`self-start text-sm font-semibold underline-offset-2 hover:underline`}
            style={{ color: colors.textMuted }}
          >
            לא רלוונטי — הסר
          </button>
        </div>
      </div>
    </article>
  );
}
