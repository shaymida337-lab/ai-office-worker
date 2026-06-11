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
          <div key={p.id} className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm" dir="rtl">
            <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="min-w-0 break-words text-xl font-black leading-7 text-[#111827] [overflow-wrap:anywhere]">{p.supplier || "לא ידוע"}</h2>
                <p className="mt-1 min-w-0 break-words text-sm font-semibold leading-6 text-[#111827] [overflow-wrap:anywhere]">{p.emailSender ?? "שולח לא ידוע"}</p>
              </div>
              <StatusPill tone={p.paid ? "ok" : "warn"}>{p.paid ? "שולם" : "ממתין"}</StatusPill>
            </div>
            <div className="grid min-w-0 gap-2 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
              <MobileRow label="סכום" value={`₪${p.amount.toLocaleString("he-IL")}`} />
              <MobileRow label="תאריך" value={new Date(p.date).toLocaleDateString("he-IL")} />
              <MobileRow label="לתשלום עד" value={p.dueDate ? new Date(p.dueDate).toLocaleDateString("he-IL") : "—"} />
              <MobileRow label="חשבונית חסרה" value={p.missingInvoice ? "כן" : "לא"} />
              <MobileRow label="מקורות" value={(p.sources ?? []).join(", ") || "—"} />
              <MobileRow label="כפילות" value={p.duplicateDetected ? `כן (${p.duplicateReason ?? "זוהתה"})` : "לא"} />
            </div>
            <div className="mt-4 grid gap-2">
              {(p.invoiceLink || p.documentLink) && <button className="min-h-[44px] w-full rounded-xl border border-[#1D4ED8] bg-white px-4 py-3 text-center text-sm font-bold text-[#111827] shadow-sm transition hover:bg-[#EFF6FF]" type="button" onClick={() => setPreviewUrl(p.invoiceLink ?? p.documentLink)}>תצוגה מקדימה</button>}
              {p.documentLink && <a className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#1D4ED8] bg-white px-4 py-3 text-center text-sm font-bold text-[#111827] shadow-sm transition hover:bg-[#EFF6FF]" href={p.documentLink} target="_blank" rel="noreferrer">פתח מסמך</a>}
              {p.invoiceLink && <a className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#1D4ED8] bg-white px-4 py-3 text-center text-sm font-bold text-[#111827] shadow-sm transition hover:bg-[#EFF6FF]" href={p.invoiceLink} target="_blank" rel="noreferrer">פתח חשבונית</a>}
              <button className="min-h-[44px] w-full rounded-xl border border-red-600 bg-red-600 px-4 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60" type="button" onClick={() => deletePayment(p)} disabled={deletingId === p.id}>
                {deletingId === p.id ? "מוחק..." : "מחק תשלום"}
              </button>
              {!p.paid && (
                <button className="min-h-[44px] w-full rounded-xl border border-[#1D4ED8] bg-[#1D4ED8] px-4 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#1746c7] disabled:opacity-60" onClick={() => markPaid(p.id)} disabled={updatingId === p.id}>
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
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/70 p-0 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4" role="dialog" aria-modal="true" onClick={() => setPreviewUrl(null)}>
          <div className="h-screen w-full overflow-hidden bg-white p-4 text-[#111827] sm:h-[85vh] sm:max-w-5xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2>תצוגה מקדימה לחשבונית</h2>
              <div className="grid gap-2 sm:flex">
                <a className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#1D4ED8] bg-white px-4 py-3 text-sm font-bold text-[#111827]" href={previewUrl} target="_blank" rel="noreferrer">פתח בדרייב</a>
                <button className="min-h-[44px] rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm font-bold text-[#111827]" type="button" onClick={() => setPreviewUrl(null)}>סגור</button>
              </div>
            </div>
            <iframe className="h-[calc(100vh-9rem)] w-full rounded-2xl border border-[var(--border-subtle)] bg-white sm:h-[calc(85vh-8rem)]" src={toDrivePreviewUrl(previewUrl)} title="Invoice preview" />
          </div>
        </div>
      )}
    </div>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm leading-6 text-[#111827]">
      <span className="shrink-0 font-black text-[#111827]">{label}:</span>
      <span className="min-w-0 flex-1 break-words text-left font-semibold text-[#111827] [overflow-wrap:anywhere]">{value || "—"}</span>
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
