"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Pencil } from "lucide-react";
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
  onApprove: (id: string, supplierName: string) => void;
  onOpen: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  const view = presentDocument(item);
  const previewUrl = drivePreviewUrl(item.driveFileUrl);
  const [editingSupplier, setEditingSupplier] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState(view.supplier);

  useEffect(() => {
    setSupplierDraft(view.supplier);
    setEditingSupplier(false);
  }, [item.id, view.supplier]);

  function handlePrimary() {
    if (view.canApprove) {
      onApprove(item.id, supplierDraft.trim() || view.supplier);
      return;
    }
    if (view.canEditSupplier && (editingSupplier || view.primaryLabel === "ערוך ספק")) {
      setEditingSupplier(true);
      return;
    }
    if (previewUrl) {
      onOpen(previewUrl);
    }
  }

  function handleSecondary() {
    if (view.secondaryLabel === "ערוך פרטים" || view.canEditSupplier) {
      setEditingSupplier(true);
      return;
    }
    if (previewUrl) {
      onOpen(previewUrl);
    }
  }

  function confirmSupplierEdit() {
    const next = supplierDraft.trim();
    if (!next) return;
    setEditingSupplier(false);
    onApprove(item.id, next);
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
              style={{
                backgroundColor: view.canApprove ? colors.accentSoft : colors.warnBg,
                color: view.canApprove ? colors.accent : colors.warnText,
              }}
            >
              {view.typeLabel}
            </span>
            <span className={`${typography.caption} font-semibold`} style={{ color: colors.textMuted }}>
              {sourceLabel(item.source)} · {formatDocumentDate(item.createdAt)}
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-start gap-2">
              {editingSupplier ? (
                <input
                  type="text"
                  value={supplierDraft}
                  onChange={(event) => setSupplierDraft(event.target.value)}
                  className={`${radius.control} ${typography.cardTitle} w-full border px-3 py-2`}
                  style={{
                    color: colors.textPrimary,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  }}
                  aria-label="שם ספק"
                />
              ) : (
                <h2 className={`${typography.cardTitle} break-words`} style={{ color: colors.textPrimary }}>
                  {supplierDraft || view.supplier}
                </h2>
              )}
              {view.canEditSupplier && !editingSupplier && (
                <button
                  type="button"
                  className={`${radius.pill} inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold`}
                  style={{ color: colors.accent, backgroundColor: colors.accentSoft }}
                  onClick={() => setEditingSupplier(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  ערוך ספק
                </button>
              )}
            </div>
            {view.rawSupplierName && view.rawSupplierName !== (supplierDraft || view.supplier) && (
              <p className={`${typography.caption} mt-1`} style={{ color: colors.textMuted }}>
                זוהה במקור: {view.rawSupplierName}
              </p>
            )}
            <p className={`${typography.kpiValue} mt-2 text-[28px] md:text-[32px]`} style={{ color: colors.accent }}>
              {view.amountLabel}
            </p>
            <p className={`${typography.caption} mt-1 font-semibold`} style={{ color: colors.textMuted }}>
              {view.documentTypeLabel}
            </p>
          </div>

          {view.missingFields.length > 0 && (
            <ul className={`${typography.body} list-disc space-y-1 pr-5 leading-7`} style={{ color: colors.dangerText }}>
              {view.missingFields.map((field) => (
                <li key={field.id}>{field.labelHebrew}</li>
              ))}
            </ul>
          )}

          {view.advisoryFields.length > 0 && view.missingFields.length === 0 && (
            <ul className={`${typography.caption} list-disc space-y-1 pr-5 leading-6`} style={{ color: colors.textSecondary }}>
              {view.advisoryFields.map((field) => (
                <li key={field.id}>{field.labelHebrew}</li>
              ))}
            </ul>
          )}

          <p className={`${typography.body} leading-7`} style={{ color: colors.textSecondary }}>
            {view.reason}
          </p>

          <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {editingSupplier ? (
              <>
                <button
                  type="button"
                  disabled={updating || exiting || !supplierDraft.trim()}
                  onClick={confirmSupplierEdit}
                  className={`${radius.control} ${button.primary} w-full sm:w-auto`}
                  style={{
                    backgroundColor: colors.accent,
                    border: `1px solid ${colors.accent}`,
                    color: colors.surface,
                  }}
                >
                  {updating ? "מעדכן..." : "אשר ספק והעבר לחשבוניות"}
                </button>
                <button
                  type="button"
                  disabled={updating || exiting}
                  onClick={() => {
                    setSupplierDraft(view.supplier);
                    setEditingSupplier(false);
                  }}
                  className={`${radius.control} ${button.secondary} w-full sm:w-auto`}
                  style={{
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    color: colors.textSecondary,
                  }}
                >
                  ביטול
                </button>
              </>
            ) : (
              <>
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
                  {updating ? "מעדכן..." : view.primaryLabel}
                </button>
                {view.secondaryLabel && (previewUrl || view.secondaryLabel === "ערוך פרטים") && (
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
                    {previewUrl && view.secondaryLabel !== "ערוך פרטים" ? (
                      <ExternalLink className="h-4 w-4" />
                    ) : null}
                    {view.secondaryLabel}
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              disabled={updating || exiting}
              onClick={() => onRemove(item.id)}
              className={`${radius.control} ${button.secondary} w-full sm:w-auto`}
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.dangerBorder}`,
                color: colors.dangerText,
              }}
            >
              {view.rejectLabel}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
