"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { Download, FileText, Filter, Loader2, RefreshCcw, Search } from "lucide-react";

type ClientItem = { id: string; name: string; gmailConnected: boolean };
type InvoicePaymentStatus = "paid" | "pending" | "overdue";
type InvoiceReviewStatus = "approved" | "needs_review" | "rejected";
type InvoiceStatus = InvoicePaymentStatus | "needs_review" | "rejected";
type Invoice = {
  id: string;
  clientId: string;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  date: string;
  dueDate: string | null;
  status: InvoiceStatus;
  reviewStatus?: InvoiceReviewStatus;
  source?: "invoice" | "gmail_scan_item" | "financial_document_review";
  reviewSourceId?: string | null;
  description: string | null;
  driveUrl: string | null;
  gmailMessageLink?: string | null;
  supplierName?: string | null;
  decisionReason?: string | null;
  client?: { id: string; name: string; color: string | null };
};

type ClientsResponse = { clients: ClientItem[] };
type InvoicesResponse = { invoices: Invoice[] };

const statusLabels: Record<string, string> = { paid: "שולם", pending: "ממתין", overdue: "באיחור", needs_review: "דורש בדיקה", rejected: "נדחה" };
const reviewStatusLabels: Record<InvoiceReviewStatus, string> = { approved: "אושר", needs_review: "דורש בדיקה", rejected: "נדחה" };
const reviewTabs: Array<{ value: "all" | InvoiceReviewStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "needs_review", label: "Needs Review" },
  { value: "rejected", label: "Rejected" },
];

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState("all");
  const [reviewStatus, setReviewStatus] = useState<"all" | InvoiceReviewStatus>("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
        (reviewStatus === "all" || (invoice.reviewStatus ?? "approved") === reviewStatus) &&
        (!search || `${invoice.invoiceNumber ?? ""} ${invoice.description ?? ""} ${invoice.client?.name ?? ""} ${invoice.supplierName ?? ""}`.toLowerCase().includes(search.toLowerCase())) &&
        (!fromDate || date >= fromDate) &&
        (!toDate || date <= toDate)
      );
    });
  }, [clientId, fromDate, invoices, reviewStatus, search, toDate]);

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
        setMessage("לא נמצאו לקוחות עם ג׳ימייל מחובר לסריקה. חבר ג׳ימייל ללקוח ואז נסה שוב.");
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
    if (!isPersistedInvoice(invoice)) return;
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

  async function deleteInvoice(invoice: Invoice) {
    if (!isPersistedInvoice(invoice)) return;
    const confirmed = window.confirm(`למחוק את החשבונית ${invoice.invoiceNumber ?? invoice.id} בסכום ${formatCurrency(invoice.amount, invoice.currency)}? הפעולה תמחק את הרשומה מה-DB.`);
    if (!confirmed) return;
    setDeletingId(invoice.id);
    setMessageTone("info");
    setMessage("");
    try {
      const result = await apiFetch<{ deleted?: { invoices?: number }; verification?: { beforeCount?: number; afterCount?: number }; unlinked?: { bankTransactions?: number; whatsappMessages?: number } }>(`/api/invoices/${invoice.id}`, {
        method: "DELETE",
      });
      if ((result.deleted?.invoices ?? 0) < 1 || (result.verification?.afterCount ?? 1) !== 0) {
        throw new Error(`השרת לא מחק את החשבונית. נמחקו ${result.deleted?.invoices ?? 0}, נשארו ${result.verification?.afterCount ?? "לא ידוע"}.`);
      }
      setSelected(null);
      setInvoices((prev) => prev.filter((item) => item.id !== invoice.id));
      await load();
      setMessageTone("success");
      setMessage(`נמחקו ${result.deleted?.invoices ?? 1} חשבוניות. נותקו ${result.unlinked?.bankTransactions ?? 0} התאמות בנק.`);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "מחיקת החשבונית נכשלה");
    } finally {
      setDeletingId(null);
    }
  }

  const messageClasses = {
    info: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
    success: "border-emerald-400/40 bg-emerald-50 text-emerald-700",
    error: "border-red-400/40 bg-red-50 text-red-700",
  }[messageTone];
  const visibleMessage = message.trim();

  return (
    <div className="container text-base text-[#F1F5F9]">
      <Nav />
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">חוכמת חשבוניות</div>
          <h1>חשבוניות</h1>
          <p className="text-[17px] leading-8 text-[#E2E8F0]">מעקב, סינון וסריקה של חשבוניות מכל הלקוחות.</p>
        </div>
        <button className="btn min-w-40" onClick={scanInvoices} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          {scanning ? "סורק..." : "סרוק חשבוניות"}
        </button>
      </div>
      {visibleMessage && (
        <div className={`mb-6 rounded-2xl border p-4 text-base font-medium leading-7 ${messageClasses}`}>
          <div>{visibleMessage}</div>
          {scanProgress && <div className="mt-1 flex items-center gap-2 text-base text-ink-secondary"><Loader2 className="h-4 w-4 animate-spin" />{scanProgress}</div>}
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" dir="rtl">
        <Metric label="חשבוניות החודש" value={thisMonth.length} tone="text-blue-300" />
        <Metric label="ממתין לתשלום" value={`₪${pending.toLocaleString("he-IL")}`} tone="text-red-300" />
        <Metric label="שולם" value={`₪${paid.toLocaleString("he-IL")}`} tone="text-emerald-300" />
        <Metric label="באיחור" value={overdue} tone="text-amber-300" />
      </div>

      <div className="mb-5 flex flex-wrap gap-2" dir="ltr" aria-label="Invoice review status filters">
        {reviewTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
              reviewStatus === tab.value
                ? "border-accent-primary bg-accent-primary text-white"
                : "border-[var(--border)] bg-surface-card text-[#E2E8F0] hover:bg-surface-hover"
            }`}
            onClick={() => setReviewStatus(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="card mb-5">
        <div className="mb-4 flex items-center gap-2 text-[17px] font-semibold text-[#F8FAFC]"><Filter className="h-5 w-5" />סינון וחיפוש</div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <select className="text-base text-[#F8FAFC]" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="all">כל הלקוחות</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7686]" />
            <input className="w-full rounded-2xl border border-[#e6eaf2] bg-white px-4 py-3 pr-10 font-sans text-base text-ink-primary shadow-sm outline-none placeholder:text-[#6b7686] focus:border-accent-primary focus:ring-2 focus:ring-[rgba(29,91,255,0.12)]" placeholder="חיפוש לפי מספר חשבונית" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <input className="text-base text-[#F8FAFC]" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input className="text-base text-[#F8FAFC]" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="card">
          <h2>לא נמצאו חשבוניות</h2>
          <p className="mt-2 text-base text-[#6b7686]">
            נסה לשנות את הסינון או להפעיל סריקת חשבוניות ללקוחות עם ג׳ימייל מחובר.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:hidden">
        {filtered.map((invoice) => (
          <div key={invoice.id} className="card">
            {isPersistedInvoice(invoice) && <div className="mb-3 flex justify-end">
              <button className="rounded-xl border border-red-400/60 bg-red-500/20 px-3 py-2 text-sm font-bold text-red-100" type="button" onClick={() => deleteInvoice(invoice)} disabled={deletingId === invoice.id}>
                {deletingId === invoice.id ? "מוחק..." : "מחק"}
              </button>
            </div>}
            <button type="button" className="w-full text-right" onClick={() => setSelected(invoice)}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words">{invoice.client?.name ?? invoice.supplierName ?? "חשבונית לבדיקה"}</h2>
                  <p className="text-base text-[#E2E8F0]">{new Date(invoice.date).toLocaleDateString("he-IL")} · {invoice.invoiceNumber ?? "ללא מספר"}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className={`badge ${statusBadgeClass(invoice)}`}>
                    {invoice.reviewStatus && invoice.reviewStatus !== "approved" ? reviewStatusLabels[invoice.reviewStatus] : statusLabels[invoice.status]}
                  </span>
                </div>
              </div>
              {invoice.description && <p className="mb-4 break-words text-base leading-7 text-[#E2E8F0]">{invoice.description}</p>}
              {!isPersistedInvoice(invoice) && <p className="mb-4 text-sm font-semibold text-amber-100">מועמדת לבדיקה מסריקת מסמכים, עדיין לא רשומת Invoice מאושרת.</p>}
              <div className="rounded-2xl bg-surface-secondary p-3 text-left text-2xl font-bold text-ink-primary">
                {formatCurrency(invoice.amount, invoice.currency)}
              </div>
            </button>
            <div className="mt-4 grid gap-2">
              {invoice.driveUrl && (
                <a className="btn btn-secondary" href={invoice.driveUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />פתח קובץ
                </a>
              )}
              {invoice.gmailMessageLink && (
                <a className="btn btn-secondary" href={invoice.gmailMessageLink} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />פתח מייל
                </a>
              )}
              {isPersistedInvoice(invoice) && <button className="btn btn-secondary" onClick={() => toggleStatus(invoice)}>
                {invoice.status === "paid" ? "סמן כממתינה" : "סמן כשולמה"}
              </button>}
              {isPersistedInvoice(invoice) && <button className="btn btn-secondary border-red-400/50 text-red-200" onClick={() => deleteInvoice(invoice)} disabled={deletingId === invoice.id}>
                {deletingId === invoice.id ? "מוחק..." : "מחק חשבונית"}
              </button>}
            </div>
          </div>
        ))}
      </div>

      <div className="table-shell hidden max-w-full overflow-x-auto md:block">
        <table className="min-w-[980px] table-fixed">
          <thead><tr><th className="w-24 text-base font-bold text-[#F8FAFC]">מחק</th><th className="w-28 text-base font-bold text-[#F8FAFC]">תאריך</th><th className="w-36 text-base font-bold text-[#F8FAFC]">לקוח</th><th className="w-28 text-base font-bold text-[#F8FAFC]">מספר</th><th className="text-base font-bold text-[#F8FAFC]">תיאור</th><th className="w-36 text-base font-bold text-[#F8FAFC]">סכום</th><th className="w-24 text-base font-bold text-[#F8FAFC]">סטטוס</th><th className="w-24 text-base font-bold text-[#F8FAFC]">דרייב</th><th className="w-24 text-base font-bold text-[#F8FAFC]">פעולות</th></tr></thead>
          <tbody>
            {filtered.map((invoice) => (
              <tr key={invoice.id} onClick={() => setSelected(invoice)} className="cursor-pointer">
                <td>
                  {isPersistedInvoice(invoice) ? <button className="rounded-xl border border-red-400/60 bg-red-500/20 px-3 py-2 text-sm font-bold text-red-100 transition hover:bg-red-500/30" onClick={(e) => { e.stopPropagation(); deleteInvoice(invoice); }} disabled={deletingId === invoice.id}>
                    {deletingId === invoice.id ? "מוחק..." : "מחק"}
                  </button> : <span className="text-base text-[#CBD5E1]">-</span>}
                </td>
                <td className="whitespace-nowrap text-base text-[#F1F5F9]">{new Date(invoice.date).toLocaleDateString("he-IL")}</td>
                <td><span className="inline-flex max-w-full items-center gap-2 text-base text-[#F1F5F9]"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-hover text-sm font-bold text-ink-primary">{(invoice.client?.name ?? invoice.supplierName ?? "בדיקה").slice(0, 2)}</span><span className="truncate">{invoice.client?.name ?? invoice.supplierName ?? "לבדיקה"}</span></span></td>
                <td className="truncate text-base text-[#F8FAFC]">{invoice.invoiceNumber ?? "-"}</td>
                <td className="max-w-0 truncate text-base text-[#E2E8F0]">{invoice.description ?? ""}</td>
                <td className="whitespace-nowrap text-base font-bold text-[#F8FAFC]">{formatCurrency(invoice.amount, invoice.currency)}</td>
                <td><span className={`badge ${statusBadgeClass(invoice)}`}>{invoice.reviewStatus && invoice.reviewStatus !== "approved" ? reviewStatusLabels[invoice.reviewStatus] : statusLabels[invoice.status]}</span></td>
                <td>{invoice.driveUrl ? <a className="btn btn-secondary px-2 py-1 text-sm" href={invoice.driveUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Download className="h-3.5 w-3.5" />קובץ</a> : <span className="text-base text-[#CBD5E1]">-</span>}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {invoice.gmailMessageLink && <a className="rounded-lg border border-[var(--border)] bg-surface-card px-2 py-1 text-sm font-semibold text-[#E2E8F0] transition hover:bg-surface-hover hover:text-[#F8FAFC]" href={invoice.gmailMessageLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>מייל</a>}
                    {isPersistedInvoice(invoice) && <button className="rounded-lg border border-[var(--border)] bg-surface-card px-2 py-1 text-sm font-semibold text-[#E2E8F0] opacity-100 transition hover:bg-surface-hover hover:text-[#F8FAFC]" onClick={(e) => { e.stopPropagation(); toggleStatus(invoice); }}>{invoice.status === "paid" ? "סמן כממתינה" : "סמן כשולמה"}</button>}
                    {isPersistedInvoice(invoice) && <button className="rounded-lg border border-red-400/50 bg-red-500/10 px-2 py-1 text-sm font-semibold text-red-100 transition hover:bg-red-500/20" onClick={(e) => { e.stopPropagation(); deleteInvoice(invoice); }} disabled={deletingId === invoice.id}>{deletingId === invoice.id ? "מוחק..." : "מחק"}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 text-right text-slate-950 shadow-2xl animate-[toastSlide_.25s_ease] sm:p-7" dir="rtl">
            <div className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                  <FileText className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-extrabold uppercase tracking-wide text-blue-700">פרטי חשבונית</p>
                  <h2 className="mt-1 text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
                    {selected.supplierName || selected.client?.name || "חשבונית לבדיקה"}
                  </h2>
                  <p className="mt-2 text-base font-semibold leading-7 text-slate-600">
                    {selected.reviewStatus === "needs_review" ? "חשבונית שמורה וממתינה לאישור" : reviewStatusLabels[selected.reviewStatus ?? "approved"]}
                  </p>
                </div>
              </div>
              <span className={`w-fit rounded-full px-4 py-2 text-sm font-black ${
                selected.reviewStatus === "needs_review"
                  ? "bg-amber-100 text-amber-900"
                  : selected.reviewStatus === "rejected"
                    ? "bg-red-100 text-red-800"
                    : "bg-emerald-100 text-emerald-800"
              }`}>
                {reviewStatusLabels[selected.reviewStatus ?? "approved"]}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <DetailCard label="ספק" value={selected.supplierName || "לא זוהה"} />
              <DetailCard label="לקוח" value={selected.client?.name || "לא משויך"} />
              <DetailCard label="סכום" value={formatCurrency(selected.amount, selected.currency)} highlight />
              <DetailCard label="מספר חשבונית" value={selected.invoiceNumber || "ללא מספר"} />
              <DetailCard label="תאריך" value={new Date(selected.date).toLocaleDateString("he-IL")} />
              <DetailCard label="מקור" value={sourceLabel(selected.source)} />
            </div>

            {selected.description && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 text-sm font-black text-slate-600">תיאור</div>
                <p className="whitespace-pre-wrap break-words text-base font-semibold leading-8 text-slate-950">{selected.description}</p>
              </div>
            )}

            {selected.decisionReason && (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 text-sm font-black text-amber-900">סיבת בדיקה</div>
                <p className="whitespace-pre-wrap break-words text-base font-semibold leading-8 text-amber-950">{selected.decisionReason}</p>
              </div>
            )}

            {(selected.driveUrl || selected.gmailMessageLink) && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {selected.driveUrl && (
                  <a className="inline-flex items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-600 px-4 py-3 text-base font-black text-white transition hover:bg-blue-700" href={selected.driveUrl} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />פתח קובץ בדרייב
                  </a>
                )}
                {selected.gmailMessageLink && (
                  <a className="inline-flex items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-base font-black text-blue-800 transition hover:bg-blue-100" href={selected.gmailMessageLink} target="_blank" rel="noreferrer">
                    פתח מייל מקור
                  </a>
                )}
              </div>
            )}

            {selected.driveUrl && (
              <div className="mt-6">
                <div className="mb-2 text-sm font-black text-slate-700">תצוגה מקדימה</div>
                <iframe className="h-[55vh] min-h-80 w-full rounded-2xl border border-slate-300 bg-white shadow-inner" src={toDrivePreviewUrl(selected.driveUrl)} title="Invoice preview" />
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-between">
              <button className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-base font-black text-slate-800 transition hover:bg-slate-100" onClick={() => setSelected(null)}>סגור</button>
              {isPersistedInvoice(selected) && (
                <button className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-base font-black text-red-700 transition hover:bg-red-100" onClick={() => deleteInvoice(selected)} disabled={deletingId === selected.id}>
                  {deletingId === selected.id ? "מוחק..." : "מחק חשבונית"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="card">
      <div className="stat-label text-sm text-[#CBD5E1]">{label}</div>
      <div className={`stat-value ${tone}`}>{value}</div>
    </div>
  );
}

function DetailCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${highlight ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
      <div className={`mb-2 text-sm font-black ${highlight ? "text-blue-800" : "text-slate-600"}`}>{label}</div>
      <div className={`break-words text-lg font-black leading-7 ${highlight ? "text-blue-950" : "text-slate-950"}`}>{value}</div>
    </div>
  );
}

function formatCurrency(amount: number, currency: string) {
  const symbols: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  return `${symbols[currency] ?? currency} ${amount.toLocaleString("he-IL")}`;
}

function isPersistedInvoice(invoice: Invoice) {
  return !invoice.source || invoice.source === "invoice";
}

function statusBadgeClass(invoice: Invoice) {
  const reviewStatus = invoice.reviewStatus ?? "approved";
  if (reviewStatus === "needs_review") return "badge-warn";
  if (reviewStatus === "rejected") return "badge-error";
  if (invoice.status === "paid") return "badge-ok";
  if (invoice.status === "overdue") return "badge-error";
  return "badge-warn";
}

function sourceLabel(source: Invoice["source"] | undefined) {
  if (source === "gmail_scan_item") return "סריקת Gmail";
  if (source === "financial_document_review") return "בדיקת מסמך";
  return "חשבונית מאושרת";
}

function toDrivePreviewUrl(url: string) {
  return url.replace(/\/view(?:\?.*)?$/, "/preview");
}
