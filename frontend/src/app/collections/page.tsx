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

  async function load() {
    setInvoices(await apiFetch<CustomerInvoice[]>("/api/customer-invoices"));
  }

  useEffect(() => {
    load();
  }, []);

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch("/api/customer-invoices", {
      method: "POST",
      body: JSON.stringify({ customer, amount: Number(amount), dueDate: dueDate || undefined }),
    });
    setCustomer("");
    setAmount("");
    setDueDate("");
    await load();
  }

  async function sendReminder(id: string) {
    const result = await apiFetch<{ message: string }>(`/api/customer-invoices/${id}/reminder`, {
      method: "POST",
    });
    setReminder(result.message);
    await load();
  }

  async function markPaid(id: string) {
    await apiFetch(`/api/customer-invoices/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ paid: true }),
    });
    await load();
  }

  return (
    <div className="container">
      <h1>גביית לקוחות</h1>
      <Nav />
      <div className="card">
        <form onSubmit={createInvoice}>
          <input placeholder="לקוח" value={customer} onChange={(e) => setCustomer(e.target.value)} required />
          <input placeholder="סכום" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required style={{ marginRight: "0.5rem" }} />
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ marginRight: "0.5rem" }} />
          <button className="btn" style={{ marginRight: "0.5rem" }}>הוסף חוב לקוח</button>
        </form>
      </div>
      {reminder && <div className="card"><strong>טיוטת תזכורת:</strong><p>{reminder}</p></div>}
      <div className="card">
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
                  {!i.paid && <button className="btn btn-secondary" onClick={() => markPaid(i.id)}>שולם</button>}
                  {!i.paid && <button className="btn" onClick={() => sendReminder(i.id)} style={{ marginRight: "0.5rem" }}>צור תזכורת</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
