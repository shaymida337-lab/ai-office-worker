"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type Payment } from "@/lib/api";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function loadPayments() {
    setLoading(true);
    try {
      const data = await apiFetch<Payment[]>(`/api/payments${duplicatesOnly ? "?duplicatesOnly=true" : ""}`);
      setPayments(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "טעינת תשלומי ספקים נכשלה");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
  }, [duplicatesOnly]);

  async function markPaid(id: string) {
    setUpdatingId(id);
    setMessage("");
    try {
      await apiFetch(`/api/payments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ paid: true }),
      });
      setPayments((prev) =>
        prev.map((p) => (p.id === id ? { ...p, paid: true, missingInvoice: false } : p))
      );
      setMessage("התשלום סומן כשולם");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון התשלום נכשל");
    } finally {
      setUpdatingId(null);
    }
  }

  async function deletePayment(payment: Payment) {
    const confirmed = window.confirm(`למחוק את תשלום הספק "${payment.supplier}" בסכום ₪${payment.amount.toLocaleString("he-IL")}? הפעולה תמחק את הרשומה מה-DB.`);
    if (!confirmed) return;
    setDeletingId(payment.id);
    setMessage("");
    try {
      const result = await apiFetch<{ deleted?: { supplierPayments?: number; documentReviews?: number }; unlinked?: { bankTransactions?: number; tasks?: number } }>(`/api/payments/${payment.id}`, {
        method: "DELETE",
      });
      await loadPayments();
      setMessage(`נמחקו ${result.deleted?.supplierPayments ?? 1} תשלומי ספקים. נותקו ${result.unlinked?.bankTransactions ?? 0} התאמות בנק.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת התשלום נכשלה");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">ספקים ותשלומים</div>
        <h1>תשלומי ספקים</h1>
        <p>מעקב אחרי תשלומים שזוהו מהמיילים, כולל מסמכים חסרים וסטטוס תשלום.</p>
      </div>
      <div className="mb-6 flex flex-wrap gap-3">
        <button
          className={`btn ${duplicatesOnly ? "" : "btn-secondary"}`}
          onClick={() => setDuplicatesOnly((value) => !value)}
          type="button"
        >
          {duplicatesOnly ? "מציג כפילויות בלבד" : "הצג כפילויות בלבד"}
        </button>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">{message}</div>}
      {loading && <div className="card"><p>טוען תשלומי ספקים...</p></div>}
      {!loading && payments.length === 0 && (
        <div className="card">
          <h2>עדיין אין תשלומי ספקים</h2>
          <p className="mt-2">הפעל סריקת ג׳ימייל מלוח הבקרה כדי לזהות דרישות תשלום, חשבוניות ומסמכים מספקים.</p>
        </div>
      )}

      <div className="grid gap-4 md:hidden">
        {payments.map((p) => (
          <div key={p.id} className="card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words">{p.supplier}</h2>
                <p className="break-words">{p.emailSender ?? "שולח לא ידוע"}</p>
              </div>
              <span className={`badge shrink-0 ${p.paid ? "badge-ok" : "badge-warn"}`}>{p.paid ? "שולם" : "ממתין"}</span>
            </div>
            <div className="grid gap-2 rounded-2xl bg-surface-secondary p-3">
              <MobileRow label="סכום" value={`₪${p.amount.toLocaleString("he-IL")}`} />
              <MobileRow label="תאריך" value={new Date(p.date).toLocaleDateString("he-IL")} />
              <MobileRow label="לתשלום עד" value={p.dueDate ? new Date(p.dueDate).toLocaleDateString("he-IL") : "—"} />
              <MobileRow label="חשבונית חסרה" value={p.missingInvoice ? "כן" : "לא"} />
              <MobileRow label="מקורות" value={(p.sources ?? []).join(", ") || "—"} />
              <MobileRow label="כפילות" value={p.duplicateDetected ? `כן (${p.duplicateReason ?? "זוהתה"})` : "לא"} />
            </div>
            <div className="mt-4 grid gap-2">
              {(p.invoiceLink || p.documentLink) && <button className="btn btn-secondary" type="button" onClick={() => setPreviewUrl(p.invoiceLink ?? p.documentLink)}>תצוגה מקדימה</button>}
              {p.documentLink && <a className="btn btn-secondary" href={p.documentLink} target="_blank" rel="noreferrer">פתח מסמך</a>}
              {p.invoiceLink && <a className="btn btn-secondary" href={p.invoiceLink} target="_blank" rel="noreferrer">פתח חשבונית</a>}
              <button className="btn btn-secondary border-red-400/50 text-red-200" type="button" onClick={() => deletePayment(p)} disabled={deletingId === p.id}>
                {deletingId === p.id ? "מוחק..." : "מחק תשלום"}
              </button>
              {!p.paid && (
                <button className="btn" onClick={() => markPaid(p.id)} disabled={updatingId === p.id}>
                  {updatingId === p.id ? "מעדכן..." : "סמן כתשלום ששולם"}
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
              <th>שולח</th>
              <th>סכום</th>
              <th>תאריך</th>
              <th>לתשלום עד</th>
              <th>שולם</th>
              <th>מסמך</th>
              <th>חשבונית</th>
              <th>חסרה</th>
              <th>מקורות</th>
              <th>כפילות</th>
              <th>פעולה</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.supplier}</td>
                <td>{p.emailSender ?? "—"}</td>
                <td>₪{p.amount.toLocaleString("he-IL")}</td>
                <td>{new Date(p.date).toLocaleDateString("he-IL")}</td>
                <td>
                  {p.dueDate
                    ? new Date(p.dueDate).toLocaleDateString("he-IL")
                    : "—"}
                </td>
                <td>{p.paid ? "כן" : "לא"}</td>
                <td>
                  {p.documentLink ? (
                    <button className="text-accent-primary underline-offset-4 hover:underline" type="button" onClick={() => setPreviewUrl(p.documentLink)}>
                      תצוגה
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {p.invoiceLink ? (
                    <button className="text-accent-primary underline-offset-4 hover:underline" type="button" onClick={() => setPreviewUrl(p.invoiceLink)}>
                      תצוגה
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {p.missingInvoice ? (
                    <span className="badge badge-warn">כן</span>
                  ) : (
                    <span className="badge badge-ok">לא</span>
                  )}
                </td>
                <td>{(p.sources ?? []).join(", ") || "—"}</td>
                <td>{p.duplicateDetected ? <span className="badge badge-warn">{p.duplicateReason ?? "זוהתה"}</span> : "—"}</td>
                <td>
                  {!p.paid && (
                    <button className="btn btn-secondary" onClick={() => markPaid(p.id)} disabled={updatingId === p.id}>
                      {updatingId === p.id ? "מעדכן..." : "סמן כתשלום ששולם"}
                    </button>
                  )}
                  <button className="btn btn-secondary border-red-400/50 text-red-200" onClick={() => deletePayment(p)} disabled={deletingId === p.id}>
                    {deletingId === p.id ? "מוחק..." : "מחק"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {previewUrl && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setPreviewUrl(null)}>
          <div className="card h-[85vh] w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2>תצוגה מקדימה לחשבונית</h2>
              <div className="flex gap-2">
                <a className="btn btn-secondary" href={previewUrl} target="_blank" rel="noreferrer">פתח בדרייב</a>
                <button className="btn btn-secondary" type="button" onClick={() => setPreviewUrl(null)}>סגור</button>
              </div>
            </div>
            <iframe className="h-[calc(85vh-8rem)] w-full rounded-2xl border border-[var(--border-subtle)] bg-white" src={toDrivePreviewUrl(previewUrl)} title="Invoice preview" />
          </div>
        </div>
      )}
    </div>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-ink-secondary">{label}</span>
      <span className="min-w-0 break-words text-left font-semibold text-ink-primary">{value}</span>
    </div>
  );
}

function toDrivePreviewUrl(url: string) {
  return url.replace(/\/view(?:\?.*)?$/, "/preview");
}
