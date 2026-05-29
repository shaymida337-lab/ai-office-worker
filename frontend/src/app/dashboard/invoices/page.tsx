"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { Download, FileText, Filter, Loader2, RefreshCcw, Search } from "lucide-react";

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
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
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
    load().catch((err) => {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "טעינת חשבוניות נכשלה");
    });
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
    setMessageTone("info");
    setMessage("מתחיל סריקת חשבוניות...");
    setScanProgress("");
    try {
      const targets = clients.filter((client) => (clientId === "all" || client.id === clientId) && client.gmailConnected);
      if (targets.length === 0) {
        setMessageTone("error");
        setMessage("לא נמצאו לקוחות עם Gmail מחובר לסריקה. חבר Gmail ללקוח ואז נסה שוב.");
        return;
      }

      let saved = 0;
      let found = 0;
      const errors: string[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const current = targets[index];
        setScanProgress(`סורק ${current.name} (${index + 1}/${targets.length})`);
        setMessage(`סורק מיילים ומחפש חשבוניות... (${index + 1}/${targets.length})`);
        try {
          const result = await apiFetch<{ found: number; saved: number; errors?: Array<{ error: string }> }>(`/api/clients/${current.id}/scan/invoices`, { method: "POST" });
          found += result.found ?? 0;
          saved += result.saved ?? 0;
          errors.push(...(result.errors ?? []).map((item) => item.error));
        } catch (err) {
          errors.push(`${current.name}: ${err instanceof Error ? err.message : "סריקה נכשלה"}`);
        }
      }
      await load();
      setMessageTone(errors.length ? "error" : "success");
      setMessage(errors.length ? `הסריקה הסתיימה עם שגיאות. נמצאו ${found}, נשמרו ${saved}. שגיאות: ${errors.join("; ")}` : `הסריקה הסתיימה בהצלחה. נמצאו ${found}, נשמרו ${saved} חשבוניות.`);
    } finally {
      setScanProgress("");
      setScanning(false);
    }
  }

  async function toggleStatus(invoice: Invoice) {
    const next = invoice.status === "paid" ? "pending" : "paid";
    setMessage("");
    try {
      await apiFetch(`/api/invoices/${invoice.id}/status`, { method: "PUT", body: JSON.stringify({ status: next }) });
      await load();
      setMessageTone("success");
      setMessage(next === "paid" ? "החשבונית סומנה כשולמה" : "החשבונית סומנה כממתינה");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "עדכון סטטוס חשבונית נכשל");
    }
  }

  const messageClasses = {
    info: "border-accent-primary/40 bg-accent-primary/15 text-[#E0E7FF]",
    success: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
    error: "border-red-400/40 bg-red-500/15 text-red-100",
  }[messageTone];

  return (
    <div className="container text-[16px] text-[#E2E8F0]">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">Invoice intelligence</div>
          <h1>חשבוניות</h1>
          <p className="text-base leading-7 text-[#CBD5E1]">מעקב, סינון וסריקה של חשבוניות מכל הלקוחות.</p>
        </div>
        <button className="btn min-w-40" onClick={scanInvoices} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          {scanning ? "סורק..." : "סרוק חשבוניות"}
        </button>
      </div>
      {message && (
        <div className={`mb-6 rounded-2xl border p-4 text-base font-medium leading-7 ${messageClasses}`}>
          <div>{message}</div>
          {scanProgress && <div className="mt-1 flex items-center gap-2 text-sm text-[#E2E8F0]"><Loader2 className="h-4 w-4 animate-spin" />{scanProgress}</div>}
        </div>
      )}

      <div className="grid mb-8">
        <Metric label="חשבוניות החודש" value={thisMonth.length} tone="text-blue-300" />
        <Metric label="ממתין לתשלום" value={`₪${pending.toLocaleString("he-IL")}`} tone="text-red-300" />
        <Metric label="שולם" value={`₪${paid.toLocaleString("he-IL")}`} tone="text-emerald-300" />
        <Metric label="באיחור" value={overdue} tone="text-amber-300" />
      </div>

      <div className="card">
        <div className="mb-4 flex items-center gap-2 text-base font-semibold text-[#F8FAFC]"><Filter className="h-4 w-4" />סינון וחיפוש</div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <select className="text-base" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="all">כל הלקוחות</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          <select className="text-base" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">כל הסטטוסים</option><option value="paid">שולם</option><option value="pending">ממתין</option><option value="overdue">באיחור</option></select>
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-ink-muted" />
            <input className="pr-10 text-base" placeholder="חיפוש לפי מספר חשבונית" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <input className="text-base" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input className="text-base" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 md:hidden">
        {filtered.map((invoice) => (
          <div key={invoice.id} className="card">
            <button type="button" className="w-full text-right" onClick={() => setSelected(invoice)}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words">{invoice.client?.name ?? "לקוח לא ידוע"}</h2>
                  <p className="text-base text-[#CBD5E1]">{new Date(invoice.date).toLocaleDateString("he-IL")} · {invoice.invoiceNumber ?? "ללא מספר"}</p>
                </div>
                <span className={`badge shrink-0 ${invoice.status === "paid" ? "badge-ok" : invoice.status === "overdue" ? "badge-error" : "badge-warn"}`}>
                  {statusLabels[invoice.status]}
                </span>
              </div>
              {invoice.description && <p className="mb-4 break-words text-base leading-7 text-[#CBD5E1]">{invoice.description}</p>}
              <div className="rounded-2xl bg-surface-secondary p-3 text-left text-2xl font-bold text-ink-primary">
                ₪{invoice.amount.toLocaleString("he-IL")} {invoice.currency}
              </div>
            </button>
            <div className="mt-4 grid gap-2">
              {invoice.driveUrl && (
                <a className="btn btn-secondary" href={invoice.driveUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />פתח PDF
                </a>
              )}
              <button className="btn btn-secondary" onClick={() => toggleStatus(invoice)}>
                {invoice.status === "paid" ? "סמן ממתין" : "סמן שולם"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="table-shell hidden max-w-full overflow-x-auto md:block">
        <table className="min-w-[980px] table-fixed">
          <thead><tr><th className="w-28 text-[15px] text-[#F8FAFC]">תאריך</th><th className="w-36 text-[15px] text-[#F8FAFC]">לקוח</th><th className="w-28 text-[15px] text-[#F8FAFC]">מספר</th><th className="text-[15px] text-[#F8FAFC]">תיאור</th><th className="w-36 text-[15px] text-[#F8FAFC]">סכום</th><th className="w-24 text-[15px] text-[#F8FAFC]">סטטוס</th><th className="w-24 text-[15px] text-[#F8FAFC]">Drive</th><th className="w-24 text-[15px] text-[#F8FAFC]">פעולות</th></tr></thead>
          <tbody>
            {filtered.map((invoice) => (
              <tr key={invoice.id} onClick={() => setSelected(invoice)} className="cursor-pointer">
                <td className="whitespace-nowrap text-[15px] text-[#E2E8F0]">{new Date(invoice.date).toLocaleDateString("he-IL")}</td>
                <td><span className="inline-flex max-w-full items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-hover text-[13px] font-bold text-ink-primary">{invoice.client?.name?.slice(0, 2) ?? "AI"}</span><span className="truncate">{invoice.client?.name ?? ""}</span></span></td>
                <td className="truncate text-[15px] text-[#F8FAFC]">{invoice.invoiceNumber ?? "-"}</td>
                <td className="max-w-0 truncate text-[15px] text-[#CBD5E1]">{invoice.description ?? ""}</td>
                <td className="whitespace-nowrap font-semibold text-ink-primary">₪{invoice.amount.toLocaleString("he-IL")} {invoice.currency}</td>
                <td><span className={`badge ${invoice.status === "paid" ? "badge-ok" : invoice.status === "overdue" ? "badge-error" : "badge-warn"}`}>{statusLabels[invoice.status]}</span></td>
                <td>{invoice.driveUrl ? <a className="btn btn-secondary px-2 py-1 text-xs" href={invoice.driveUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Download className="h-3.5 w-3.5" />PDF</a> : "-"}</td>
                <td><button className="rounded-lg border border-[var(--border)] bg-surface-card px-2 py-1 text-xs font-semibold text-ink-secondary opacity-90 transition hover:bg-surface-hover hover:text-ink-primary" onClick={(e) => { e.stopPropagation(); toggleStatus(invoice); }}>{invoice.status === "paid" ? "ממתין" : "שולם"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <div className="card"><p>לא נמצאו חשבוניות.</p></div>}

      {selected && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="card max-h-[85vh] w-full max-w-xl overflow-y-auto animate-[toastSlide_.25s_ease]">
            <div className="mb-4 flex items-center gap-3"><FileText className="h-5 w-5 text-accent-primary" /><h2>פרטי חשבונית</h2></div>
            <p>לקוח: {selected.client?.name}</p>
            <p>מספר: {selected.invoiceNumber ?? "-"}</p>
            <p>{selected.description}</p>
            <button className="btn btn-secondary mt-4" onClick={() => setSelected(null)}>סגור</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone}`}>{value}</div>
    </div>
  );
}
