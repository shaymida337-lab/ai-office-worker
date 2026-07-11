"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Nav } from "@/components/Nav";
import type { Invoice } from "@/components/invoices";
import { apiFetch } from "@/lib/api";
import { removeRowAfterAction } from "@/lib/invoices/animatedRemoval";
import { formatAmount } from "@/lib/format/amount";
import {
  COMPLETION_DOCUMENT_TYPES,
  completionErrorMessage,
  completionSuccessMessage,
  getInvoiceCompletionAction,
  missingFieldKeys,
  resolveInvoiceCompletionId,
  resolveInvoiceCompletionSourceType,
  shouldOpenEditAfterCompletionError,
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
  if (invoice.amount == null || !Number.isFinite(invoice.amount)) return "סכום חסר";
  return formatAmount(invoice.amount, invoice.currency, "סכום חסר");
}

function formatInvoiceDate(date: string | null | undefined) {
  if (!date) return "חסר תאריך";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "חסר תאריך";
  return parsed.toLocaleDateString("he-IL");
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

function CompletionReasons({ invoice, rowError }: { invoice: Invoice; rowError?: string }) {
  const missing = invoice.missingDataReasons ?? [];
  const approval = invoice.approvalReasons ?? [];
  const action = getInvoiceCompletionAction(invoice);
  if (missing.length === 0 && approval.length === 0 && !rowError && !action.hint) return null;
  return (
    <div className="mb-4 space-y-2 text-sm">
      {missing.length > 0 && (
        <ul className="list-disc space-y-1 pr-5 text-amber-200">
          {missing.map((reason) => (
            <li key={`missing-${reason}`}>{reason}</li>
          ))}
        </ul>
      )}
      {approval.length > 0 && (
        <ul className="list-disc space-y-1 pr-5 text-sky-200">
          {approval.map((reason) => (
            <li key={`approval-${reason}`}>{reason}</li>
          ))}
        </ul>
      )}
      {action.hint && action.kind !== "approve_only" && (
        <p className="text-amber-100">{action.hint}</p>
      )}
      {rowError && <p className="rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-red-100">{rowError}</p>}
    </div>
  );
}

function CompletionEditModal({
  invoice,
  draft,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  invoice: Invoice;
  draft: EditDraft;
  saving: boolean;
  onChange: (next: EditDraft) => void;
  onClose: () => void;
  onSave: (approveAfterSave: boolean) => void;
}) {
  const missing = missingFieldKeys(invoice);
  const action = getInvoiceCompletionAction(invoice);
  const showAll = missing.size === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <h2 className="mb-2">השלמת פרטי חשבונית</h2>
        <p className="mb-4 text-sm text-ink-secondary">
          {invoice.supplierName?.trim() || "ספק לא זוהה"} · {formatInvoiceAmount(invoice)}
        </p>
        <div className="space-y-4">
          {(showAll || missing.has("supplier")) && (
            <label className="block">
              <span className="mb-1 block text-sm">ספק {missing.has("supplier") ? "*" : ""}</span>
              <input
                className="input w-full"
                value={draft.supplier}
                onChange={(e) => onChange({ ...draft, supplier: e.target.value })}
              />
            </label>
          )}
          {(showAll || missing.has("amount")) && (
            <label className="block">
              <span className="mb-1 block text-sm">סכום {missing.has("amount") ? "*" : ""}</span>
              <input
                className="input w-full"
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
                className="input w-full"
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
                className="input w-full"
                value={draft.currency}
                onChange={(e) => onChange({ ...draft, currency: e.target.value })}
              />
            </label>
          )}
          {(showAll || missing.has("documentType")) && (
            <label className="block">
              <span className="mb-1 block text-sm">סוג מסמך {missing.has("documentType") ? "*" : ""}</span>
              <select
                className="input w-full"
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
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving}
            onClick={() => onSave(action.kind === "complete_and_approve")}
          >
            {saving ? "שומר..." : action.kind === "complete_and_approve" ? "השלם ואשר" : "שמור"}
          </button>
        </div>
      </div>
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
      setEditingInvoice(invoice);
      setEditDraft(buildEditDraft(invoice));
    }
  }

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InvoicesResponse>("/api/invoices?completeness=incomplete");
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

  function finalizeSuccess(invoice: Invoice, actionKind: InvoiceCompletionActionKind) {
    setRowErrors((current) => {
      const next = { ...current };
      delete next[invoice.id];
      return next;
    });
    setInvoices((current) => current.filter((item) => item.id !== invoice.id));
    showMessage("success", completionSuccessMessage(actionKind));
  }

  function openEditForm(invoice: Invoice) {
    setEditingInvoice(invoice);
    setEditDraft(buildEditDraft(invoice));
    setMessage("");
    setRowErrors((current) => {
      const next = { ...current };
      delete next[invoice.id];
      return next;
    });
  }

  function handlePrimaryAction(invoice: Invoice) {
    const action = getInvoiceCompletionAction(invoice);
    if (action.kind === "none" || action.kind === "blocked") return;

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

    openEditForm(invoice);
  }

  async function handleEditSave(approveAfterSave: boolean) {
    if (!editingInvoice || !editDraft) return;
    setSavingEdit(true);
    setMessage("");
    const invoice = editingInvoice;
    const draft = editDraft;
    try {
      const response = await completeInvoiceRequest(invoice, {
        approve: approveAfterSave,
        fields: draft,
      });
      if (response.destination === "invoices" || response.approved) {
        setEditingInvoice(null);
        setEditDraft(null);
        await removeRowAfterAction({
          performAction: async () => {},
          beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
          waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
          finalize: async () =>
            finalizeSuccess(invoice, approveAfterSave ? "complete_and_approve" : "complete_details"),
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
        setMessageTone("success");
        setMessage("הפרטים נשמרו. נדרש אישור נוסף לפני העברה לחשבוניות.");
      }
    } catch (err) {
      reportActionError(invoice, err);
    } finally {
      setSavingEdit(false);
    }
  }

  function renderActionButton(invoice: Invoice) {
    const action = getInvoiceCompletionAction(invoice);
    if (action.kind === "none") return null;
    return (
      <button
        className="btn btn-primary"
        type="button"
        disabled={actingId === invoice.id || action.kind === "blocked"}
        onClick={() => handlePrimaryAction(invoice)}
      >
        {actingId === invoice.id ? "מעבד..." : action.primaryLabel}
      </button>
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
                <h2 className="break-words">{invoice.supplierName?.trim() || "ספק לא זוהה"}</h2>
                <p className="break-words">{invoice.description ?? "ללא תיאור"}</p>
                <div className="my-3 text-sm text-ink-secondary">{formatInvoiceDate(invoice.date)}</div>
                <div className="my-4 rounded-2xl bg-surface-secondary p-3 text-left text-2xl font-bold text-ink-primary">
                  {formatInvoiceAmount(invoice)}
                </div>
                <CompletionReasons invoice={invoice} rowError={rowErrors[invoice.id]} />
                <div className="flex flex-wrap gap-2">
                  {(invoice.driveFileUrl || invoice.driveUrl) && (
                    <a
                      className="btn btn-secondary"
                      href={invoice.driveFileUrl || invoice.driveUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      פתח מסמך
                    </a>
                  )}
                  {renderActionButton(invoice)}
                </div>
              </div>
            ))}
          </div>
          <div className="table-shell hidden md:block">
            <table>
              <thead>
                <tr>
                  <th>ספק</th>
                  <th>תאריך</th>
                  <th>סכום</th>
                  <th>סיבות להשלמה</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className={`transition-opacity duration-300 ${removingIds.has(invoice.id) ? "opacity-0" : "opacity-100"}`}
                  >
                    <td>{invoice.supplierName?.trim() || "ספק לא זוהה"}</td>
                    <td>{formatInvoiceDate(invoice.date)}</td>
                    <td>{formatInvoiceAmount(invoice)}</td>
                    <td>
                      {[...(invoice.missingDataReasons ?? []), ...(invoice.approvalReasons ?? [])].join(" · ") || "—"}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {(invoice.driveFileUrl || invoice.driveUrl) && (
                          <a href={invoice.driveFileUrl || invoice.driveUrl || "#"} target="_blank" rel="noreferrer">
                            פתח מסמך
                          </a>
                        )}
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
          onChange={setEditDraft}
          onClose={() => {
            setEditingInvoice(null);
            setEditDraft(null);
          }}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
}
