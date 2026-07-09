"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Pencil } from "lucide-react";
import { Button, Card, Input, StatusBadge } from "@/components/natalie-ui";
import {
  drivePreviewUrl,
  formatDocumentDate,
  presentDocument,
  resolveDocumentPrimaryClick,
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
    const action = resolveDocumentPrimaryClick({
      item,
      view,
      editingSupplier,
      supplierDraft,
      hasPreviewUrl: Boolean(previewUrl),
    });
    if (action.type === "approve") {
      console.info("[document-review] approve_click", {
        reviewId: item.id,
        supplierName: action.supplierName,
        decisionCanApprove: item.decision?.canApprove ?? null,
        viewCanApprove: view.canApprove,
      });
      onApprove(item.id, action.supplierName);
      return;
    }
    if (action.type === "edit_supplier") {
      setEditingSupplier(true);
      return;
    }
    if (action.type === "open_preview" && previewUrl) {
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
    console.info("[document-review] approve_click", {
      reviewId: item.id,
      supplierName: next,
      source: "confirm_supplier_edit",
    });
    onApprove(item.id, next);
  }

  return (
    <Card
      padding="none"
      className={`overflow-hidden transition-all duration-300 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 ${
        exiting ? "pointer-events-none translate-x-4 scale-[0.98] opacity-0" : "opacity-100"
      } ${view.isBlocked ? "border-[#FCD34D]" : ""}`}
    >
      <div className="grid gap-0 lg:grid-cols-2">
        <div className="relative min-h-[220px] border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-bg-page,#F3F6FF)] lg:min-h-[320px] lg:border-b-0 lg:border-l">
          {previewUrl ? (
            <iframe
              title={`תצוגה מקדימה — ${view.supplier}`}
              src={previewUrl}
              className="pointer-events-none h-full min-h-[220px] w-full lg:min-h-[320px]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center lg:min-h-[320px]">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#EEF2FF] text-[#1D4ED8]">
                <FileText className="h-7 w-7" strokeWidth={2} />
              </span>
              <p className="text-base font-semibold text-[var(--natalie-text-muted,#64748B)]">
                {item.fileName ?? "אין תצוגה מקדימה"}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={view.canApprove ? "info" : "warn"}>{view.typeLabel}</StatusBadge>
            <span className="text-sm font-semibold text-[var(--natalie-text-muted,#64748B)]">
              {sourceLabel(item.source)} · {formatDocumentDate(item.createdAt)}
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-start gap-2">
              {editingSupplier ? (
                <Input
                  type="text"
                  value={supplierDraft}
                  onChange={(event) => setSupplierDraft(event.target.value)}
                  className="text-lg font-black"
                  aria-label="שם ספק"
                />
              ) : (
                <h2 className="break-words text-lg font-black text-[var(--natalie-text-primary,#0F172A)] md:text-xl">
                  {supplierDraft || view.supplier}
                </h2>
              )}
              {view.canEditSupplier && !editingSupplier && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-1 text-xs font-semibold text-[#1D4ED8]"
                  onClick={() => setEditingSupplier(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  ערוך ספק
                </button>
              )}
            </div>
            {view.rawSupplierName && view.rawSupplierName !== (supplierDraft || view.supplier) && (
              <p className="mt-1 text-sm text-[var(--natalie-text-muted,#64748B)]">
                זוהה במקור: {view.rawSupplierName}
              </p>
            )}
            <p className="mt-2 text-[28px] font-black text-[#1D4ED8] md:text-[32px]">{view.amountLabel}</p>
            <p className="mt-1 text-sm font-semibold text-[var(--natalie-text-muted,#64748B)]">
              {view.documentTypeLabel}
            </p>
          </div>

          {view.missingFields.length > 0 && (
            <ul className="list-disc space-y-1 pr-5 text-base leading-7 text-[#7F1D1D]">
              {view.missingFields.map((field) => (
                <li key={field.id}>{field.labelHebrew}</li>
              ))}
            </ul>
          )}

          {view.advisoryFields.length > 0 && view.missingFields.length === 0 && (
            <ul className="list-disc space-y-1 pr-5 text-sm leading-6 text-[var(--natalie-text-muted,#64748B)]">
              {view.advisoryFields.map((field) => (
                <li key={field.id}>{field.labelHebrew}</li>
              ))}
            </ul>
          )}

          <p className="text-base leading-7 text-[var(--natalie-text-muted,#64748B)]">{view.reason}</p>

          <div className="relative z-10 mt-auto flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {editingSupplier ? (
              <>
                <Button
                  variant="primary"
                  disabled={updating || exiting || !supplierDraft.trim()}
                  onClick={confirmSupplierEdit}
                  className="w-full sm:w-auto"
                >
                  {updating ? "מעדכן..." : "אשר ספק והעבר לחשבוניות"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={updating || exiting}
                  onClick={() => {
                    setSupplierDraft(view.supplier);
                    setEditingSupplier(false);
                  }}
                  className="w-full sm:w-auto"
                >
                  ביטול
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  disabled={updating || exiting}
                  onClick={handlePrimary}
                  className="w-full sm:w-auto"
                >
                  {updating ? "מעדכן..." : view.primaryLabel}
                </Button>
                {view.secondaryLabel && (previewUrl || view.secondaryLabel === "ערוך פרטים") && (
                  <Button
                    variant="secondary"
                    disabled={updating || exiting}
                    onClick={handleSecondary}
                    className="w-full sm:w-auto"
                  >
                    {previewUrl && view.secondaryLabel !== "ערוך פרטים" ? (
                      <ExternalLink className="h-4 w-4" />
                    ) : null}
                    {view.secondaryLabel}
                  </Button>
                )}
              </>
            )}
            <Button
              variant="danger"
              disabled={updating || exiting}
              onClick={() => onRemove(item.id)}
              className="w-full sm:w-auto"
            >
              {view.rejectLabel}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
