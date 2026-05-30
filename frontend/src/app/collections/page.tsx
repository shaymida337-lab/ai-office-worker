"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type CustomerInvoice } from "@/lib/api";

export default function CollectionsPage() {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [reminder, setReminder] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setInvoices(await apiFetch<CustomerInvoice[]>("/api/customer-invoices"));
  }

  useEffect(() => {
    load()
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת גבייה נכשלה"))
      .finally(() => setLoading(false));
  }, []);

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await apiFetch("/api/customer-invoices", {
        method: "POST",
        body: JSON.stringify({ customer, amount: Number(amount), dueDate: dueDate || undefined }),
      });
      setCustomer("");
      setAmount("");
      setDueDate("");
      setMessage("החוב נוסף בהצלחה");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת חוב נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function sendReminder(id: string) {
    setMessage("");
    try {
      const result = await apiFetch<{ message: string }>(`/api/customer-invoices/${id}/reminder`, {
        method: "POST",
      });
      setReminder(result.message);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "יצירת תזכורת נכשלה");
    }
  }

  async function markPaid(id: string) {
    setMessage("");
    try {
      await apiFetch(`/api/customer-invoices/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ paid: true }),
      });
      setMessage("החוב סומן כשולם");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון החוב נכשל");
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">גבייה</div>
        <h1>גביית לקוחות</h1>
        <p>מעקב אחרי חובות פתוחים, תאריכי יעד ותזכורות גבייה ללקוחות.</p>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">{message}</div>}
      <div className="card">
        <form onSubmit={createInvoice} className="grid gap-3 md:grid-cols-4">
          <label>
            לקוח
            <input placeholder="שם לקוח" value={customer} onChange={(e) => setCustomer(e.target.value)} required />
          </label>
          <label>
            סכום
            <input placeholder="סכום" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label>
            תאריך יעד
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <button className="btn self-end" disabled={saving}>{saving ? "שומר..." : "הוסף חוב לקוח"}</button>
        </form>
      </div>
      {reminder && <div className="card"><strong>טיוטת תזכורת:</strong><p>{reminder}</p></div>}
      {loading && <div className="card"><p>טוען חובות לקוחות...</p></div>}
      {!loading && invoices.length === 0 && (
        <div className="card">
          <h2>אין חובות פתוחים</h2>
          <p className="mt-2">הוסף חוב לקוח ידנית או הפעל סריקות כדי להתחיל לנהל גבייה במקום אחד.</p>
        </div>
      )}

      <div className="grid gap-4 md:hidden">
        {invoices.map((i) => (
          <div key={i.id} className="card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2>{i.customer}</h2>
                <p>{i.dueDate ? `יעד: ${new Date(i.dueDate).toLocaleDateString("he-IL")}` : "ללא תאריך יעד"}</p>
              </div>
              <span className={`badge shrink-0 ${i.paid ? "badge-ok" : "badge-warn"}`}>{i.paid ? "שולם" : "ממתין"}</span>
            </div>
            <div className="mb-4 rounded-2xl bg-surface-secondary p-3 text-left text-2xl font-bold text-ink-primary">
              ₪{i.amount.toLocaleString("he-IL")}
            </div>
            {!i.paid && (
              <div className="grid gap-2">
                <button className="btn btn-secondary" onClick={() => markPaid(i.id)}>סמן כחוב ששולם</button>
                <button className="btn" onClick={() => sendReminder(i.id)}>צור תזכורת</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="table-shell hidden md:block">
        <table>
          <thead>
            <tr><th>לקוח</th><th>סכום</th><th>תאריך יעד</th><th>שולם</th><th>פעולות</th></tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>{i.customer}</td>
                <td>₪{i.amount.toLocaleString("he-IL")}</td>
                <td>{i.dueDate ? new Date(i.dueDate).toLocaleDateString("he-IL") : "—"}</td>
                <td>{i.paid ? "כן" : "לא"}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                  {!i.paid && <button className="btn btn-secondary" onClick={() => markPaid(i.id)}>סמן כחוב ששולם</button>}
                  {!i.paid && <button className="btn" onClick={() => sendReminder(i.id)}>צור תזכורת</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
