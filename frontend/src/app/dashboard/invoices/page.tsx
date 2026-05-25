"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type ClientItem = { id: string; name: string; gmailConnected: boolean };
type InvoiceStatus = "paid" | "pending" | "overdue";
type Invoice = {
  id: string;
  clientId: string;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  date: string;
  dueDate: string | null;
  status: InvoiceStatus;
  description: string | null;
  driveUrl: string | null;
  client?: { id: string; name: string; color: string | null };
};

type ClientsResponse = { clients: ClientItem[] };
type InvoicesResponse = { invoices: Invoice[] };

const statusLabels: Record<string, string> = { paid: "שולם", pending: "ממתין", overdue: "באיחור" };

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [message, setMessage] = useState("");
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);

  async function load() {
    const [invoiceData, clientData] = await Promise.all([
      apiFetch<InvoicesResponse>("/api/invoices"),
      apiFetch<ClientsResponse>("/api/clients"),
    ]);
    setInvoices(invoiceData.invoices);
    setClients(clientData.clients);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת חשבוניות נכשלה"));
  }, []);

  const filtered = useMemo(() => {
    return invoices.filter((invoice) => {
      const date = invoice.date.slice(0, 10);
      return (
        (clientId === "all" || invoice.clientId === clientId) &&
        (status === "all" || invoice.status === status) &&
        (!search || `${invoice.invoiceNumber ?? ""} ${invoice.description ?? ""} ${invoice.client?.name ?? ""}`.toLowerCase().includes(search.toLowerCase())) &&
        (!fromDate || date >= fromDate) &&
        (!toDate || date <= toDate)
      );
    });
  }, [clientId, fromDate, invoices, search, status, toDate]);

  const now = new Date();
  const thisMonth = filtered.filter((invoice) => {
    const date = new Date(invoice.date);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const paid = filtered.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const pending = filtered.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const overdue = filtered.filter((invoice) => invoice.status === "overdue").length;

  async function scanInvoices() {
    setScanning(true);
    setMessage("סורק מיילים...");
    try {
      const targets = clients.filter((client) => (clientId === "all" || client.id === clientId) && client.gmailConnected);
      let saved = 0;
      const errors: string[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        setMessage(`סורק מיילים... (${index + 1}/${targets.length})`);
        try {
          const result = await apiFetch<{ found: number; saved: number; errors: Array<{ error: string }> }>(`/api/clients/${targets[index].id}/scan/invoices`, { method: "POST" });
          saved += result.saved;
          errors.push(...result.errors.map((item) => item.error));
        } catch (err) {
          errors.push(err instanceof Error ? err.message : "סריקה נכשלה");
        }
      }
      await load();
      setMessage(errors.length ? `נמצאו ${saved} חשבוניות חדשות. שגיאות: ${errors.join("; ")}` : `נמצאו ${saved} חשבוניות חדשות`);
    } finally {
      setScanning(false);
    }
  }

  async function toggleStatus(invoice: Invoice) {
    const next = invoice.status === "paid" ? "pending" : "paid";
    await apiFetch(`/api/invoices/${invoice.id}/status`, { method: "PUT", body: JSON.stringify({ status: next }) });
    await load();
  }

  return (
    <div className="container">
      <h1>חשבוניות</h1>
      <Nav />
      {message && <p>{message}</p>}
      <div className="grid">
        <div className="card"><div className="stat-label">חשבוניות החודש</div><div className="stat-value">{thisMonth.length}</div></div>
        <div className="card"><div className="stat-label">ממתין לתשלום</div><div className="stat-value" style={{ color: "var(--danger)" }}>₪{pending.toLocaleString("he-IL")}</div></div>
        <div className="card"><div className="stat-label">שולם</div><div className="stat-value" style={{ color: "var(--ok)" }}>₪{paid.toLocaleString("he-IL")}</div></div>
        <div className="card"><div className="stat-label">באיחור</div><div className="stat-value" style={{ color: "var(--danger)" }}>{overdue}</div></div>
      </div>

      <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <button className="btn" onClick={scanInvoices} disabled={scanning}>{scanning ? "סורק..." : "סרוק חשבוניות"}</button>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="all">כל הלקוחות</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">כל הסטטוסים</option><option value="paid">שולם</option><option value="pending">ממתין</option><option value="overdue">באיחור</option></select>
        <input placeholder="חיפוש לפי מספר חשבונית" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>תאריך</th><th>לקוח</th><th>מספר</th><th>תיאור</th><th>סכום</th><th>סטטוס</th><th>Drive</th><th>פעולות</th></tr></thead>
          <tbody>
            {filtered.map((invoice) => (
              <tr key={invoice.id} onClick={() => setSelected(invoice)} style={{ cursor: "pointer" }}>
                <td>{new Date(invoice.date).toLocaleDateString("he-IL")}</td>
                <td>{invoice.client?.name ?? ""}</td>
                <td>{invoice.invoiceNumber ?? "-"}</td>
                <td>{invoice.description ?? ""}</td>
                <td>₪{invoice.amount.toLocaleString("he-IL")} {invoice.currency}</td>
                <td><span className={`badge ${invoice.status === "paid" ? "badge-ok" : "badge-warn"}`}>{statusLabels[invoice.status]}</span></td>
                <td>{invoice.driveUrl ? <a href={invoice.driveUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PDF</a> : "-"}</td>
                <td><button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); toggleStatus(invoice); }}>{invoice.status === "paid" ? "סמן ממתין" : "סמן שולם"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p>לא נמצאו חשבוניות</p>}
      </div>

      {selected && (
        <div className="card">
          <h2>פרטי חשבונית</h2>
          <p>לקוח: {selected.client?.name}</p>
          <p>מספר: {selected.invoiceNumber ?? "-"}</p>
          <p>{selected.description}</p>
          <button className="btn btn-secondary" onClick={() => setSelected(null)}>סגור</button>
        </div>
      )}
    </div>
  );
}
