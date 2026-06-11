"use client";

import type { ReactNode } from "react";
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
      const result = await apiFetch<{ deleted?: { supplierPayments?: number; documentReviews?: number }; verification?: { beforeCount?: number; afterCount?: number }; unlinked?: { bankTransactions?: number; tasks?: number } }>(`/api/payments/${payment.id}/delete`, {
        method: "POST",
      });
      if ((result.deleted?.supplierPayments ?? 0) < 1 || (result.verification?.afterCount ?? 1) !== 0) {
        throw new Error(`השרת לא מחק את הרשומה. נמחקו ${result.deleted?.supplierPayments ?? 0}, נשארו ${result.verification?.afterCount ?? "לא ידוע"}.`);
      }
      setPayments((prev) => prev.filter((item) => item.id !== payment.id));
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
        <p className="mt-2 text-base font-semibold leading-7 text-[#111827]">מעקב אחרי תשלומים שזוהו מהמיילים, כולל מסמכים חסרים וסטטוס תשלום.</p>
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
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className={`badge ${p.paid ? "badge-ok" : "badge-warn"}`}>{p.paid ? "שולם" : "ממתין"}</span>
              </div>
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

      <div className="table-shell hidden max-w-full overflow-x-auto md:block">
        <table className="min-w-[1320px] border-separate border-spacing-0 text-right text-[#111827]" dir="rtl">
          <thead>
            <tr>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">מחק</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">ספק</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">שולח</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">סכום</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">תאריך</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">לתשלום עד</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">שולם</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">מסמך</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">חשבונית</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">חסרה</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">מקורות</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">כפילות</th>
              <th className="whitespace-nowrap px-4 py-3 align-middle text-sm font-black text-[#111827]">פעולה</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 align-middle text-[#111827]">
                  <button className="min-w-[72px] whitespace-nowrap rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm disabled:opacity-60" onClick={() => deletePayment(p)} disabled={deletingId === p.id}>
                    {deletingId === p.id ? "מוחק..." : "מחק"}
                  </button>
                </td>
                <td className="px-4 py-3 align-middle text-[#111827]">
                  <span className="block min-w-40 break-words font-bold text-[#111827]">{p.supplier}</span>
                </td>
                <td className="px-4 py-3 align-middle font-semibold text-[#111827]">{p.emailSender ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 align-middle font-bold text-[#111827]">₪{p.amount.toLocaleString("he-IL")}</td>
                <td className="whitespace-nowrap px-4 py-3 align-middle font-semibold text-[#111827]">{new Date(p.date).toLocaleDateString("he-IL")}</td>
                <td className="whitespace-nowrap px-4 py-3 align-middle font-semibold text-[#111827]">
                  {p.dueDate
                    ? new Date(p.dueDate).toLocaleDateString("he-IL")
                    : "—"}
                </td>
                <td className="px-4 py-3 align-middle">
                  <StatusPill tone={p.paid ? "ok" : "warn"}>{p.paid ? "כן" : "לא"}</StatusPill>
                </td>
                <td className="px-4 py-3 align-middle font-semibold text-[#111827]">
                  {p.documentLink ? (
                    <button className="min-w-[72px] whitespace-nowrap rounded-xl border border-[#1D4ED8] bg-[#DBEAFE] px-3 py-2 text-sm font-bold text-[#111827] hover:bg-[#BFDBFE]" type="button" onClick={() => setPreviewUrl(p.documentLink)}>
                      תצוגה
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 align-middle font-semibold text-[#111827]">
                  {p.invoiceLink ? (
                    <button className="min-w-[72px] whitespace-nowrap rounded-xl border border-[#1D4ED8] bg-[#DBEAFE] px-3 py-2 text-sm font-bold text-[#111827] hover:bg-[#BFDBFE]" type="button" onClick={() => setPreviewUrl(p.invoiceLink)}>
                      תצוגה
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
                  {p.missingInvoice ? (
                    <StatusPill tone="warn">כן</StatusPill>
                  ) : (
                    <StatusPill tone="ok">לא</StatusPill>
                  )}
                </td>
                <td className="px-4 py-3 align-middle font-semibold text-[#111827]">{(p.sources ?? []).join(", ") || "—"}</td>
                <td className="px-4 py-3 align-middle font-semibold text-[#111827]">{p.duplicateDetected ? <StatusPill tone="warn">{p.duplicateReason ?? "זוהתה"}</StatusPill> : "—"}</td>
                <td className="px-4 py-3 align-middle">
                  {!p.paid && (
                    <button className="min-w-[172px] whitespace-nowrap rounded-xl border border-[#1D4ED8] bg-white px-4 py-2 text-sm font-bold text-[#111827] shadow-sm transition hover:bg-[#EFF6FF] disabled:opacity-60" onClick={() => markPaid(p.id)} disabled={updatingId === p.id}>
                      {updatingId === p.id ? "מעדכן..." : "סמן כתשלום ששולם"}
                    </button>
                  )}
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

function StatusPill({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  const toneClass = tone === "ok"
    ? "border-emerald-600 bg-emerald-100 text-[#111827]"
    : "border-amber-600 bg-amber-100 text-[#111827]";
  return (
    <span className={`inline-flex min-w-[44px] items-center justify-center rounded-full border px-3 py-1 text-sm font-black ${toneClass}`}>
      {children}
    </span>
  );
}

function toDrivePreviewUrl(url: string) {
  return url.replace(/\/view(?:\?.*)?$/, "/preview");
}
