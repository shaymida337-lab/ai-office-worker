"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import type { Invoice } from "@/components/invoices";
import { apiFetch } from "@/lib/api";
import { approvalErrorHebrew } from "@/lib/documents/presentation";
import { removeRowAfterAction } from "@/lib/invoices/animatedRemoval";
import { formatAmount } from "@/lib/format/amount";

type InvoicesResponse = { invoices: Invoice[] };

const REMOVAL_ANIMATION_MS = 250;

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

export default function ReportsClient() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InvoicesResponse>("/api/invoices?completeness=incomplete");
      setInvoices(data.invoices);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "טעינת השלמת חשבוניות נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  async function approveInvoiceRequest(invoice: Invoice): Promise<void> {
    if (invoice.source === "financial_document_review" || invoice.source === "supplier_payment") {
      const id = invoice.reviewSourceId ?? invoice.id.replace(/^document-review:/, "").replace(/^supplier-payment:/, "");
      await apiFetch(`/api/document-reviews/${id}/approve`, { method: "POST" });
      return;
    }
    if (invoice.source === "gmail_scan_item") {
      const id = invoice.reviewSourceId ?? invoice.id.replace(/^gmail-scan:/, "");
      await apiFetch(`/api/gmail-scan-items/${id}/approve`, { method: "POST" });
      return;
    }
    throw new Error("לא ניתן לאשר חשבונית מסוג זה");
  }

  function handleApprove(invoice: Invoice) {
    if (invoice.source === "invoice") return;
    setMessage("");
    setApprovingId(invoice.id);
    void removeRowAfterAction({
      performAction: () => approveInvoiceRequest(invoice),
      beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
      waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
      finalize: async () => {
        setInvoices((current) => current.filter((item) => item.id !== invoice.id));
        setMessageTone("success");
        setMessage("החשבונית הושלמה ועברה למסך חשבוניות");
      },
      endExitAnimation: () =>
        setRemovingIds((current) => {
          const next = new Set(current);
          next.delete(invoice.id);
          return next;
        }),
      reportError: (err) => {
        setMessageTone("error");
        setMessage(err instanceof Error ? approvalErrorHebrew(err.message) : "אישור החשבונית נכשל");
      },
    }).finally(() => setApprovingId(null));
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">חשבוניות</div>
        <h1>השלמת חשבוניות</h1>
        <p>מסמכים שחסרים בהם שדות חובה או שדורשים אישור לפני שיופיעו במסך חשבוניות.</p>
      </div>
      {message && (
        <div
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
                {invoice.completionReasons && invoice.completionReasons.length > 0 && (
                  <ul className="mb-4 list-disc space-y-1 pr-5 text-sm text-amber-200">
                    {invoice.completionReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
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
                  {invoice.source !== "invoice" && invoice.reviewStatus === "needs_review" && (
                    <button
                      className="btn btn-primary"
                      disabled={approvingId === invoice.id}
                      onClick={() => handleApprove(invoice)}
                    >
                      {approvingId === invoice.id ? "מאשר..." : "אשר והשלם"}
                    </button>
                  )}
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
                    <td>{invoice.completionReasons?.join(" · ") || "—"}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {(invoice.driveFileUrl || invoice.driveUrl) && (
                          <a href={invoice.driveFileUrl || invoice.driveUrl || "#"} target="_blank" rel="noreferrer">
                            פתח מסמך
                          </a>
                        )}
                        {invoice.source !== "invoice" && invoice.reviewStatus === "needs_review" && (
                          <button
                            className="btn btn-primary"
                            disabled={approvingId === invoice.id}
                            onClick={() => handleApprove(invoice)}
                          >
                            {approvingId === invoice.id ? "מאשר..." : "אשר והשלם"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
