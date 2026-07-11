"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Nav } from "@/components/Nav";
import type { Invoice } from "@/components/invoices";
import { apiFetch } from "@/lib/api";
import { removeRowAfterAction } from "@/lib/invoices/animatedRemoval";
import { formatAmount } from "@/lib/format/amount";
import {
  COMPLETION_DOCUMENT_TYPES,
  completionErrorMessage,
  completionSuccessMessage,
  getDocumentPreviewUrl,
  getInvoiceCompletionAction,
  getInvoiceStatusChips,
  missingFieldKeys,
  resolveInvoiceCompletionId,
  resolveInvoiceCompletionSourceType,
  shouldOpenEditAfterCompletionError,
  type CompletionFieldKey,
  type InvoiceCompletionActionKind,
  type InvoiceCompletionResponse,
} from "@/lib/invoices/completionActions";

type InvoicesResponse = { invoices: Invoice[] };

const REMOVAL_ANIMATION_MS = 250;

type EditDraft = {
  supplier: string;
  amount: string;
  date: string;
  documentType: string;
  currency: string;
};

function formatInvoiceAmount(invoice: Invoice) {
  if (invoice.amountLabel) return invoice.amountLabel;
  if (invoice.amount == null || !Number.isFinite(invoice.amount)) return "חסר";
  return formatAmount(invoice.amount, invoice.currency, "חסר");
}

function formatInvoiceDate(date: string | null | undefined) {
  if (!date) return "חסר";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "חסר";
  return parsed.toLocaleDateString("he-IL");
}

function formatDocumentTypeLabel(documentType: string | null | undefined) {
  if (!documentType?.trim()) return "חסר";
  const match = COMPLETION_DOCUMENT_TYPES.find((type) => type.value === documentType);
  return match?.label ?? documentType;
}

function formatRowStatus(invoice: Invoice) {
  const action = getInvoiceCompletionAction(invoice);
  if (action.kind === "blocked") return "חסום";
  if (action.kind === "not_invoice") return "לא חשבונית";
  if (action.kind === "approve_only") return "מוכן לאישור";
  if (action.kind === "edit_supplier") return "ממתין לאישור ספק";
  if (!invoice.dataComplete) return "חסר פרטים";
  if (invoice.approvalRequired) return "ממתין לאישור";
  return "בהשלמה";
}

function toDateInputValue(date: string | null | undefined): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function buildEditDraft(invoice: Invoice): EditDraft {
  return {
    supplier: invoice.supplierName?.trim() ?? "",
    amount: invoice.amount != null && Number.isFinite(invoice.amount) ? String(invoice.amount) : "",
    date: toDateInputValue(invoice.date),
    documentType: invoice.documentType?.trim() ?? "",
    currency: invoice.currency?.trim() || "ILS",
  };
}

function StatusChips({ invoice }: { invoice: Invoice }) {
  const chips = getInvoiceStatusChips(invoice);
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          key={chip}
          className={`rounded-full px-2.5 py-1 text-xs ${
            chip === "חסום"
              ? "bg-red-400/15 text-red-100"
              : chip === "ממתין לאישור"
                ? "bg-sky-400/15 text-sky-100"
                : "bg-amber-400/15 text-amber-100"
          }`}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function CompletionEditModal({
  invoice,
  draft,
  saving,
  focusField,
  onChange,
  onClose,
  onSave,
}: {
  invoice: Invoice;
  draft: EditDraft;
  saving: boolean;
  focusField?: CompletionFieldKey;
  onChange: (next: EditDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const missing = missingFieldKeys(invoice);
  const showAll = missing.size === 0;
  const previewUrl = getDocumentPreviewUrl(invoice);
  const supplierRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLInputElement>(null);
  const documentTypeRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const refs: Record<CompletionFieldKey, RefObject<HTMLInputElement | HTMLSelectElement | null>> = {
      supplier: supplierRef,
      amount: amountRef,
      date: dateRef,
      currency: currencyRef,
      documentType: documentTypeRef,
    };
    const target = focusField ? refs[focusField]?.current : null;
    if (target) {
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    }
  }, [focusField]);

  function fieldClass(field: CompletionFieldKey) {
    const highlighted = focusField === field || missing.has(field);
    return `input w-full ${highlighted ? "ring-2 ring-amber-400/80" : ""}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <h2 className="mb-2">השלמת פרטי חשבונית</h2>
        <p className="mb-4 text-sm text-ink-secondary">
          {invoice.supplierName?.trim() || "ספק לא זוהה"} · {formatInvoiceAmount(invoice)}
        </p>
        {previewUrl && (
          <div className="mb-4 rounded-2xl border border-white/10 bg-surface-secondary p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm text-ink-secondary">תצוגת מסמך</span>
              <a className="text-sm text-sky-300 underline" href={previewUrl} target="_blank" rel="noreferrer">
                פתח בחלון חדש
              </a>
            </div>
            {previewUrl.includes("drive.google.com") || previewUrl.includes("/uploads/") ? (
              <iframe
                title="תצוגת מסמך"
                src={previewUrl.includes("drive.google.com") ? previewUrl.replace("/view", "/preview") : previewUrl}
                className="h-56 w-full rounded-xl border border-white/10 bg-white"
              />
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-ink-secondary">
                {invoice.description?.trim() || invoice.invoiceNumber?.trim() || "מסמך מקור"}
              </div>
            )}
          </div>
        )}
        <div className="space-y-4">
          {(showAll || missing.has("supplier")) && (
            <label className="block">
              <span className="mb-1 block text-sm">ספק {missing.has("supplier") ? "*" : ""}</span>
              <input
                ref={supplierRef}
                className={fieldClass("supplier")}
                value={draft.supplier}
                onChange={(e) => onChange({ ...draft, supplier: e.target.value })}
              />
            </label>
          )}
          {(showAll || missing.has("amount")) && (
            <label className="block">
              <span className="mb-1 block text-sm">סכום {missing.has("amount") ? "*" : ""}</span>
              <input
                ref={amountRef}
                className={fieldClass("amount")}
                type="number"
                min="0"
                step="0.01"
                value={draft.amount}
                onChange={(e) => onChange({ ...draft, amount: e.target.value })}
              />
            </label>
          )}
          {(showAll || missing.has("date")) && (
            <label className="block">
              <span className="mb-1 block text-sm">תאריך {missing.has("date") ? "*" : ""}</span>
              <input
                ref={dateRef}
                className={fieldClass("date")}
                type="date"
                value={draft.date}
                onChange={(e) => onChange({ ...draft, date: e.target.value })}
              />
            </label>
          )}
          {(showAll || missing.has("currency")) && (
            <label className="block">
              <span className="mb-1 block text-sm">מטבע {missing.has("currency") ? "*" : ""}</span>
              <input
                ref={currencyRef}
                className={fieldClass("currency")}
                value={draft.currency}
                onChange={(e) => onChange({ ...draft, currency: e.target.value })}
              />
            </label>
          )}
          {(showAll || missing.has("documentType")) && (
            <label className="block">
              <span className="mb-1 block text-sm">סוג מסמך {missing.has("documentType") ? "*" : ""}</span>
              <select
                ref={documentTypeRef}
                className={fieldClass("documentType")}
                value={draft.documentType}
                onChange={(e) => onChange({ ...draft, documentType: e.target.value })}
              >
                <option value="">בחר סוג מסמך</option>
                {COMPLETION_DOCUMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn btn-secondary" type="button" disabled={saving} onClick={onClose}>
            ביטול
          </button>
          <button className="btn btn-primary" type="button" disabled={saving} onClick={onSave}>
            {saving ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InvoiceRowDetails({ invoice, rowError }: { invoice: Invoice; rowError?: string }) {
  const action = getInvoiceCompletionAction(invoice);
  return (
    <div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div><span className="text-ink-secondary">ספק: </span>{invoice.supplierName?.trim() || "חסר"}</div>
        <div><span className="text-ink-secondary">סכום: </span>{formatInvoiceAmount(invoice)}</div>
        <div><span className="text-ink-secondary">תאריך: </span>{formatInvoiceDate(invoice.date)}</div>
        <div><span className="text-ink-secondary">סוג מסמך: </span>{formatDocumentTypeLabel(invoice.documentType)}</div>
        <div><span className="text-ink-secondary">סטטוס: </span>{formatRowStatus(invoice)}</div>
      </div>
      <StatusChips invoice={invoice} />
      {action.hint && action.kind !== "approve_only" && (
        <p className="mt-2 text-sm text-amber-100">{action.hint}</p>
      )}
      {rowError && <p className="mt-2 rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-100">{rowError}</p>}
    </div>
  );
}

export default function ReportsClient() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editFocusField, setEditFocusField] = useState<CompletionFieldKey | undefined>(undefined);
  const [savingEdit, setSavingEdit] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const messageRef = useRef<HTMLDivElement | null>(null);

  function showMessage(tone: "info" | "success" | "error", text: string) {
    setMessageTone(tone);
    setMessage(text);
    window.requestAnimationFrame(() => messageRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  function reportActionError(invoice: Invoice, err: unknown) {
    const text = completionErrorMessage(err instanceof Error ? err.message : "האישור נכשל. נסה שוב.");
    setRowErrors((current) => ({ ...current, [invoice.id]: text }));
    showMessage("error", text);
    if (shouldOpenEditAfterCompletionError(text)) {
      openEditForm(invoice, "supplier");
    }
  }

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InvoicesResponse>("/api/invoices?completeness=incomplete&limit=300");
      setInvoices(data.invoices);
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "טעינת השלמת חשבוניות נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  async function completeInvoiceRequest(
    invoice: Invoice,
    options: { approve: boolean; fields?: Partial<EditDraft> },
  ): Promise<InvoiceCompletionResponse> {
    const sourceType = resolveInvoiceCompletionSourceType(invoice);
    if (!sourceType) throw new Error("לא ניתן לטפל בחשבונית מסוג זה");

    const id = resolveInvoiceCompletionId(invoice);
    const body: Record<string, unknown> = { approve: options.approve };
    if (options.fields) {
      if (options.fields.supplier !== undefined) body.supplier = options.fields.supplier.trim();
      if (options.fields.amount !== undefined && options.fields.amount.trim()) {
        const amount = Number(options.fields.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("לא ניתן לאשר — חסר סכום");
        body.amount = amount;
      }
      if (options.fields.date !== undefined && options.fields.date.trim()) body.date = options.fields.date;
      if (options.fields.documentType !== undefined && options.fields.documentType.trim()) {
        body.documentType = options.fields.documentType.trim();
      }
      if (options.fields.currency !== undefined && options.fields.currency.trim()) {
        body.currency = options.fields.currency.trim();
      }
    }

    return apiFetch<InvoiceCompletionResponse>(`/api/invoices/${sourceType}/${id}/complete`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function removeInvoiceFromQueue(invoice: Invoice) {
    const sourceType = resolveInvoiceCompletionSourceType(invoice);
    const id = resolveInvoiceCompletionId(invoice);
    if (sourceType === "document-review") {
      await apiFetch(`/api/document-reviews/${id}`, { method: "DELETE" });
      return;
    }
    if (sourceType === "gmail-scan-item") {
      await apiFetch(`/api/gmail-scan-items/${id}`, { method: "DELETE" });
      return;
    }
    throw new Error("לא ניתן להסיר מסמך מסוג זה מהתור");
  }

  function finalizeSuccess(invoice: Invoice, actionKind: InvoiceCompletionActionKind) {
    setRowErrors((current) => {
      const next = { ...current };
      delete next[invoice.id];
      return next;
    });
    setInvoices((current) => current.filter((item) => item.id !== invoice.id));
    showMessage("success", completionSuccessMessage(actionKind));
  }

  function openEditForm(invoice: Invoice, focusField?: CompletionFieldKey) {
    const action = getInvoiceCompletionAction(invoice);
    setEditingInvoice(invoice);
    setEditDraft(buildEditDraft(invoice));
    setEditFocusField(focusField ?? action.focusField);
    setMessage("");
    setRowErrors((current) => {
      const next = { ...current };
      delete next[invoice.id];
      return next;
    });
  }

  function openDocument(invoice: Invoice) {
    const url = getDocumentPreviewUrl(invoice);
    if (!url) {
      showMessage("error", "לא נמצא קישור למסמך");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handlePrimaryAction(invoice: Invoice) {
    const action = getInvoiceCompletionAction(invoice);
    if (action.kind === "none") return;

    if (action.kind === "blocked") {
      openDocument(invoice);
      return;
    }

    if (action.kind === "not_invoice") {
      setActingId(invoice.id);
      void removeRowAfterAction({
        performAction: async () => {
          await removeInvoiceFromQueue(invoice);
        },
        beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
        waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
        finalize: async () => finalizeSuccess(invoice, action.kind),
        endExitAnimation: () =>
          setRemovingIds((current) => {
            const next = new Set(current);
            next.delete(invoice.id);
            return next;
          }),
        reportError: (err) => reportActionError(invoice, err),
      }).finally(() => setActingId(null));
      return;
    }

    if (action.kind === "approve_only") {
      setMessage("");
      setActingId(invoice.id);
      void removeRowAfterAction({
        performAction: async () => {
          await completeInvoiceRequest(invoice, { approve: true });
        },
        beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
        waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
        finalize: async () => finalizeSuccess(invoice, action.kind),
        endExitAnimation: () =>
          setRemovingIds((current) => {
            const next = new Set(current);
            next.delete(invoice.id);
            return next;
          }),
        reportError: (err) => reportActionError(invoice, err),
      }).finally(() => setActingId(null));
      return;
    }

    openEditForm(invoice, action.focusField);
  }

  async function handleEditSave() {
    if (!editingInvoice || !editDraft) return;
    setSavingEdit(true);
    setMessage("");
    const invoice = editingInvoice;
    const draft = editDraft;
    try {
      const response = await completeInvoiceRequest(invoice, {
        approve: false,
        fields: draft,
      });
      if (response.destination === "invoices" || response.approved) {
        setEditingInvoice(null);
        setEditDraft(null);
        setEditFocusField(undefined);
        await removeRowAfterAction({
          performAction: async () => {},
          beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
          waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
          finalize: async () => finalizeSuccess(invoice, "complete_details"),
          endExitAnimation: () =>
            setRemovingIds((current) => {
              const next = new Set(current);
              next.delete(invoice.id);
              return next;
            }),
          reportError: (err) => {
            setMessageTone("error");
            setMessage(completionErrorMessage(err instanceof Error ? err.message : "השמירה נכשלה"));
          },
        });
      } else {
        setInvoices((current) => current.map((item) => (item.id === invoice.id ? response.invoice : item)));
        setEditingInvoice(null);
        setEditDraft(null);
        setEditFocusField(undefined);
        const nextAction = getInvoiceCompletionAction(response.invoice);
        setMessageTone("success");
        setMessage(
          nextAction.kind === "approve_only"
            ? "הפרטים נשמרו. ניתן לאשר את החשבונית."
            : "הפרטים נשמרו. עדיין חסרים פרטים נדרשים.",
        );
      }
    } catch (err) {
      reportActionError(invoice, err);
    } finally {
      setSavingEdit(false);
    }
  }

  function handleNotInvoice(invoice: Invoice) {
    const action = getInvoiceCompletionAction(invoice);
    if (action.kind === "not_invoice") {
      handlePrimaryAction(invoice);
      return;
    }
    if (!window.confirm("להסיר את המסמך מתור ההשלמה?")) return;
    setActingId(invoice.id);
    void removeRowAfterAction({
      performAction: async () => {
        await removeInvoiceFromQueue(invoice);
      },
      beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
      waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
      finalize: async () => finalizeSuccess(invoice, "not_invoice"),
      endExitAnimation: () =>
        setRemovingIds((current) => {
          const next = new Set(current);
          next.delete(invoice.id);
          return next;
        }),
      reportError: (err) => reportActionError(invoice, err),
    }).finally(() => setActingId(null));
  }

  function renderActionButton(invoice: Invoice) {
    const action = getInvoiceCompletionAction(invoice);
    if (action.kind === "none") return null;
    return (
      <button
        className="btn btn-primary"
        type="button"
        disabled={actingId === invoice.id}
        onClick={() => handlePrimaryAction(invoice)}
      >
        {actingId === invoice.id ? "מעבד..." : action.primaryLabel}
      </button>
    );
  }

  function renderSecondaryActions(invoice: Invoice) {
    const previewUrl = getDocumentPreviewUrl(invoice);
    return (
      <>
        {previewUrl && (
          <button className="btn btn-secondary" type="button" onClick={() => openDocument(invoice)}>
            הצג מסמך
          </button>
        )}
        <button className="btn btn-secondary" type="button" onClick={() => openEditForm(invoice)}>
          ערוך
        </button>
        <button className="btn btn-secondary" type="button" disabled={actingId === invoice.id} onClick={() => handleNotInvoice(invoice)}>
          לא חשבונית
        </button>
      </>
    );
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">חשבוניות</div>
        <h1>השלמת חשבוניות</h1>
        <p>מסמכים שחסרים בהם שדות חובה או שממתינים לאישור לפני שיופיעו במסך חשבוניות.</p>
      </div>
      {message && (
        <div
          ref={messageRef}
          className={`mb-6 rounded-2xl border p-4 text-base ${
            messageTone === "error"
              ? "border-red-400/30 bg-red-400/10 text-red-100"
              : messageTone === "success"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : "border-sky-400/30 bg-sky-400/10 text-sky-100"
          }`}
        >
          {message}
        </div>
      )}
      {loading ? (
        <div className="card"><p>טוען השלמת חשבוניות...</p></div>
      ) : invoices.length === 0 ? (
        <div className="card">
          <h2 className="text-emerald-300">אין מסמכים להשלמה כרגע</h2>
          <p className="mt-2">כל החשבוניות מלאות ומאושרות — הן מוצגות במסך חשבוניות.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:hidden">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className={`card transition-opacity duration-300 ${removingIds.has(invoice.id) ? "opacity-0" : "opacity-100"}`}
              >
                <InvoiceRowDetails invoice={invoice} rowError={rowErrors[invoice.id]} />
                <div className="mt-4 flex flex-wrap gap-2">
                  {renderSecondaryActions(invoice)}
                  {renderActionButton(invoice)}
                </div>
              </div>
            ))}
          </div>
          <div className="table-shell hidden md:block">
            <table>
              <thead>
                <tr>
                  <th>פרטים</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className={`align-top transition-opacity duration-300 ${removingIds.has(invoice.id) ? "opacity-0" : "opacity-100"}`}
                  >
                    <td>
                      <InvoiceRowDetails invoice={invoice} rowError={rowErrors[invoice.id]} />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {renderSecondaryActions(invoice)}
                        {renderActionButton(invoice)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editingInvoice && editDraft && (
        <CompletionEditModal
          invoice={editingInvoice}
          draft={editDraft}
          saving={savingEdit}
          focusField={editFocusField}
          onChange={setEditDraft}
          onClose={() => {
            setEditingInvoice(null);
            setEditDraft(null);
            setEditFocusField(undefined);
          }}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
}
