"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type Payment } from "@/lib/api";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<Payment[]>(`/api/payments${duplicatesOnly ? "?duplicatesOnly=true" : ""}`)
      .then(setPayments)
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת תשלומי ספקים נכשלה"))
      .finally(() => setLoading(false));
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
              {p.documentLink && <a className="btn btn-secondary" href={p.documentLink} target="_blank" rel="noreferrer">פתח מסמך</a>}
              {p.invoiceLink && <a className="btn btn-secondary" href={p.invoiceLink} target="_blank" rel="noreferrer">פתח חשבונית</a>}
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
                    <a href={p.documentLink} target="_blank" rel="noreferrer">
                      פתח מסמך
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {p.invoiceLink ? (
                    <a href={p.invoiceLink} target="_blank" rel="noreferrer">
                      פתח חשבונית
                    </a>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
