"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { Check, ChevronDown, ChevronLeft, Download, FileText, Filter, Loader2, RefreshCcw, Search, UploadCloud } from "lucide-react";

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
  driveFileUrl?: string | null;
  gmailMessageLink?: string | null;
  supplierName?: string | null;
  decisionReason?: string | null;
  client?: { id: string; name: string; color: string | null };
};

type MonthSummary = {
  year: number;
  month: number;
  count: number;
  totalsByCurrency: Record<string, number>;
};

type ClientsResponse = { clients: ClientItem[] };
type InvoicesResponse = { invoices: Invoice[] };
type InvoiceMonthsResponse = { months: MonthSummary[] };
type InvoiceDeleteResponse = {
  deleted?: { invoices?: number; gmailScanItems?: number; documentReviews?: number };
  verification?: { after?: { invoices?: number; gmailScanItems?: number; documentReviews?: number }; afterCount?: number };
  unlinked?: { bankTransactions?: number; whatsappMessages?: number; tasks?: number };
};

const reviewStatusLabels: Record<InvoiceReviewStatus, string> = { approved: "מאושר", needs_review: "דורש בדיקה", rejected: "נדחה" };
const MISSING_VALUE = "לא זוהה";
const reviewTabs: Array<{ value: "all" | InvoiceReviewStatus; label: string }> = [
  { value: "all", label: "הכול" },
  { value: "approved", label: "מאושר" },
  { value: "needs_review", label: "דורש בדיקה" },
  { value: "rejected", label: "נדחה" },
];

export default function InvoicesPage() {
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());
  const [invoicesByMonth, setInvoicesByMonth] = useState<Record<string, Invoice[]>>({});
  const [loadingMonth, setLoadingMonth] = useState<Set<string>>(() => new Set());
  const [monthsLoading, setMonthsLoading] = useState(true);
  const [junkDrawerExpanded, setJunkDrawerExpanded] = useState(false);
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
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Invoice | null>(null);
  const skipFilterRefresh = useRef(true);

  function buildListQueryString() {
    const params = new URLSearchParams();
    if (clientId !== "all") params.set("clientId", clientId);
    if (search.trim()) params.set("search", search.trim());
    if (reviewStatus !== "all") params.set("status", reviewStatus);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function loadClients() {
    const clientData = await apiFetch<ClientsResponse>("/api/clients");
    setClients(clientData.clients);
  }

  async function loadMonthInvoices(monthKey: string, querySuffix = buildListQueryString()) {
    setLoadingMonth((current) => new Set(current).add(monthKey));
    try {
      const connector = querySuffix ? "&" : "?";
      const queryBody = querySuffix.replace(/^\?/, "");
      const invoiceData = await apiFetch<InvoicesResponse>(
        `/api/invoices?month=${monthKey}${queryBody ? `${connector}${queryBody}` : ""}`
      );
      setInvoicesByMonth((current) => ({ ...current, [monthKey]: invoiceData.invoices }));
    } finally {
      setLoadingMonth((current) => {
        const next = new Set(current);
        next.delete(monthKey);
        return next;
      });
    }
  }

  async function loadMonthsInvoices(monthKeys: string[], querySuffix = buildListQueryString()) {
    if (monthKeys.length === 0) {
      setInvoicesByMonth({});
      return;
    }
    setLoadingMonth(new Set(monthKeys));
    try {
      const connector = querySuffix ? "&" : "?";
      const queryBody = querySuffix.replace(/^\?/, "");
      const results = await Promise.all(
        monthKeys.map(async (monthKey) => {
          const invoiceData = await apiFetch<InvoicesResponse>(
            `/api/invoices?month=${monthKey}${queryBody ? `${connector}${queryBody}` : ""}`
          );
          return [monthKey, invoiceData.invoices] as const;
        })
      );
      setInvoicesByMonth(Object.fromEntries(results));
    } finally {
      setLoadingMonth(new Set());
    }
  }

  async function refreshMonthsAndInvoices(monthKeysToLoad?: string[]) {
    const querySuffix = buildListQueryString();
    const monthsData = await apiFetch<InvoiceMonthsResponse>(`/api/invoices/months${querySuffix}`);
    setMonths(monthsData.months);
    const allKeys = monthsData.months.map((month) => monthKey(month.year, month.month));
    const keysToLoad = monthKeysToLoad ?? allKeys;
    setExpandedMonths((current) => {
      const next = new Set(current);
      for (const key of allKeys) next.add(key);
      return next;
    });
    await loadMonthsInvoices(keysToLoad, querySuffix);
  }

  async function load() {
    setMonthsLoading(true);
    try {
      await Promise.all([loadClients(), refreshMonthsAndInvoices()]);
    } finally {
      setMonthsLoading(false);
    }
  }

  useEffect(() => {
    load().catch((err) => {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "טעינת חשבוניות נכשלה");
    });
  }, []);

  useEffect(() => {
    if (monthsLoading) return;
    if (skipFilterRefresh.current) {
      skipFilterRefresh.current = false;
      return;
    }
    refreshMonthsAndInvoices().catch((err) => {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "רענון חשבוניות נכשל");
    });
  }, [clientId, reviewStatus, search, monthsLoading]);

  useEffect(() => {
    if (!selected) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected]);

  const allLoadedInvoices = useMemo(
    () => Object.values(invoicesByMonth).flat(),
    [invoicesByMonth]
  );

  const matchesDisplayFilters = (invoice: Invoice) => {
    const date = invoice.date.slice(0, 10);
    return (
      (!fromDate || date >= fromDate) &&
      (!toDate || date <= toDate)
    );
  };

  const junkInvoices = useMemo(() => {
    const junk: Invoice[] = [];
    const seen = new Set<string>();
    for (const invoice of allLoadedInvoices) {
      if (!isJunkInvoice(invoice) || seen.has(invoice.id)) continue;
      seen.add(invoice.id);
      if (matchesDisplayFilters(invoice)) junk.push(invoice);
    }
    return junk;
  }, [allLoadedInvoices, fromDate, toDate]);

  const monthInvoicesForDisplay = (monthKeyValue: string) => {
    const invoices = invoicesByMonth[monthKeyValue] ?? [];
    return invoices.filter((invoice) => !isJunkInvoice(invoice) && matchesDisplayFilters(invoice));
  };

  const filtered = useMemo(() => {
    const regular: Invoice[] = [];
    const seen = new Set<string>();
    const matchesDateFilters = (invoice: Invoice) => {
      const date = invoice.date.slice(0, 10);
      return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    };
    for (const month of months) {
      const key = monthKey(month.year, month.month);
      if (!expandedMonths.has(key)) continue;
      for (const invoice of invoicesByMonth[key] ?? []) {
        if (isJunkInvoice(invoice) || !matchesDateFilters(invoice) || seen.has(invoice.id)) continue;
        seen.add(invoice.id);
        regular.push(invoice);
      }
    }
    if (junkDrawerExpanded) {
      for (const invoice of junkInvoices) {
        if (!seen.has(invoice.id)) {
          seen.add(invoice.id);
          regular.push(invoice);
        }
      }
    }
    return regular;
  }, [expandedMonths, fromDate, invoicesByMonth, junkDrawerExpanded, junkInvoices, months, toDate]);

  const filteredIds = useMemo(() => filtered.map((invoice) => invoice.id), [filtered]);
  const selectedVisibleInvoices = useMemo(
    () => filtered.filter((invoice) => selectedInvoiceIds.has(invoice.id)),
    [filtered, selectedInvoiceIds]
  );
  const allVisibleSelected = filtered.length > 0 && filtered.every((invoice) => selectedInvoiceIds.has(invoice.id));

  useEffect(() => {
    setSelectedInvoiceIds((current) => {
      const visibleIds = new Set(filteredIds);
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredIds]);

  const now = new Date();
  const thisMonth = filtered.filter((invoice) => {
    const date = new Date(invoice.date);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const paid = filtered.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const pending = filtered.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const overdue = filtered.filter((invoice) => invoice.status === "overdue").length;

  function toggleMonthExpanded(monthKeyValue: string) {
    setExpandedMonths((current) => {
      const next = new Set(current);
      if (next.has(monthKeyValue)) {
        next.delete(monthKeyValue);
      } else {
        next.add(monthKeyValue);
        if (!invoicesByMonth[monthKeyValue]) {
          void loadMonthInvoices(monthKeyValue).catch((err) => {
            setMessageTone("error");
            setMessage(err instanceof Error ? err.message : "טעינת חשבוניות לחודש נכשלה");
          });
        }
      }
      return next;
    });
  }

  function removeInvoiceFromLocalState(invoiceId: string) {
    setInvoicesByMonth((current) => {
      const next: Record<string, Invoice[]> = {};
      for (const [key, rows] of Object.entries(current)) {
        next[key] = rows.filter((invoice) => invoice.id !== invoiceId);
      }
      return next;
    });
  }

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
      await refreshMonthsAndInvoices(Object.keys(invoicesByMonth));
      setMessageTone("success");
      setMessage(next === "paid" ? "החשבונית סומנה כשולמה" : "החשבונית סומנה כממתינה");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "עדכון סטטוס חשבונית נכשל");
    }
  }

  async function approveInvoice(invoice: Invoice) {
    if (invoice.source === "invoice" || isPersistedInvoice(invoice)) return;
    setMessage("");
    try {
      if (invoice.source === "financial_document_review") {
        const id = invoice.reviewSourceId ?? invoice.id.replace(/^document-review:/, "");
        await apiFetch(`/api/document-reviews/${id}/approve`, { method: "POST" });
      } else if (invoice.source === "gmail_scan_item") {
        const id = invoice.reviewSourceId ?? invoice.id.replace(/^gmail-scan:/, "");
        await apiFetch(`/api/gmail-scan-items/${id}/approve`, { method: "POST" });
      } else {
        return;
      }
      if (selected?.id === invoice.id) setSelected(null);
      await refreshMonthsAndInvoices(Object.keys(invoicesByMonth));
      setMessageTone("success");
      setMessage("החשבונית אושרה");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "אישור החשבונית נכשל");
    }
  }

  async function deleteInvoice(invoice: Invoice) {
    const confirmed = window.confirm("האם למחוק את החשבונית?");
    if (!confirmed) return;
    setDeletingId(invoice.id);
    setMessageTone("info");
    setMessage("");
    try {
      const result = await deleteInvoiceRecord(invoice);
      setSelected(null);
      setSelectedInvoiceIds((current) => {
        const next = new Set(current);
        next.delete(invoice.id);
        return next;
      });
      removeInvoiceFromLocalState(invoice.id);
      await refreshMonthsAndInvoices(Object.keys(invoicesByMonth));
      setMessageTone("success");
      setMessage(`החשבונית נמחקה. נותקו ${result.unlinked?.bankTransactions ?? 0} התאמות בנק.`);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "מחיקת החשבונית נכשלה");
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteInvoiceRecord(invoice: Invoice) {
    const target = invoiceDeleteTarget(invoice);
    const result = await apiFetch<InvoiceDeleteResponse>(target, {
      method: "DELETE",
    });
    if (!invoiceDeleteSucceeded(invoice, result)) {
      throw new Error("מחיקת החשבונית לא הושלמה. נסה שוב או פנה לתמיכה.");
    }
    return result;
  }

  function toggleInvoiceSelection(invoiceId: string) {
    setSelectedInvoiceIds((current) => {
      const next = new Set(current);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedInvoiceIds((current) => {
      if (allVisibleSelected) return new Set();
      const next = new Set(current);
      filtered.forEach((invoice) => next.add(invoice.id));
      return next;
    });
  }

  async function deleteSelectedInvoices() {
    if (selectedVisibleInvoices.length === 0) return;
    const confirmed = window.confirm(`למחוק ${selectedVisibleInvoices.length} חשבוניות?`);
    if (!confirmed) return;
    setBulkDeleting(true);
    setMessageTone("info");
    setMessage("");
    try {
      for (const invoice of selectedVisibleInvoices) {
        setDeletingId(invoice.id);
        await deleteInvoiceRecord(invoice);
      }
      const deletedIds = new Set(selectedVisibleInvoices.map((invoice) => invoice.id));
      setSelected((current) => (current && deletedIds.has(current.id) ? null : current));
      setSelectedInvoiceIds(new Set());
      for (const invoice of selectedVisibleInvoices) {
        removeInvoiceFromLocalState(invoice.id);
      }
      await refreshMonthsAndInvoices(Object.keys(invoicesByMonth));
      setMessageTone("success");
      setMessage(`${deletedIds.size} חשבוניות נמחקו.`);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "מחיקת החשבוניות נכשלה");
    } finally {
      setDeletingId(null);
      setBulkDeleting(false);
    }
  }

  const messageClasses = {
    info: "border-[#1D4ED8] bg-[#EFF6FF] text-[#111827]",
    success: "border-[#059669] bg-[#ECFDF5] text-[#111827]",
    error: "border-[#DC2626] bg-[#FEF2F2] text-[#111827]",
  }[messageTone];
  const visibleMessage = message.trim();

  return (
    <div className="container invoice-page-safe min-h-screen text-base text-[#111827]" style={{ background: "#f8fafc", color: "#111827", opacity: 1 }}>
      <style>{`
        .invoice-page-safe {
          background: #f8fafc !important;
          color: #111827 !important;
          opacity: 1 !important;
        }

        .invoice-page-safe,
        .invoice-page-safe :where(h1, h2, h3, h4, p, span, div, label, th, td, button, a, input, select, textarea) {
          color: #111827 !important;
          opacity: 1 !important;
        }

        .invoice-page-safe :where(input, select, textarea)::placeholder {
          color: #4b5563 !important;
          opacity: 1 !important;
        }

        .invoice-page-safe :where(input, select, textarea, button, a) {
          text-shadow: none !important;
        }

        .invoice-page-safe :where(input, select, textarea) {
          background: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          color: #111827 !important;
        }

        .invoice-page-safe .invoice-panel,
        .invoice-page-safe .invoice-mobile-row,
        .invoice-page-safe .invoice-table-wrap,
        .invoice-page-safe .invoice-modal,
        .invoice-page-safe .invoice-detail-surface,
        .invoice-page-safe .invoice-metric {
          background: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          color: #111827 !important;
          opacity: 1 !important;
        }

        .invoice-page-safe table,
        .invoice-page-safe tbody,
        .invoice-page-safe td {
          background: #ffffff !important;
          color: #111827 !important;
          opacity: 1 !important;
        }

        .invoice-page-safe thead,
        .invoice-page-safe th {
          background: #f3f4f6 !important;
          color: #111827 !important;
          opacity: 1 !important;
        }

        .invoice-page-safe tr {
          background: #ffffff !important;
          border-color: #e5e7eb !important;
          opacity: 1 !important;
        }

        .invoice-page-safe tbody tr:hover,
        .invoice-page-safe .invoice-mobile-row:hover {
          background: #f8fafc !important;
        }

        .invoice-page-safe tbody tr:hover td {
          background: #f8fafc !important;
        }

        .invoice-page-safe :where(th, td) {
          border-bottom: 1px solid #e5e7eb !important;
          font-weight: 800 !important;
        }

        .invoice-page-safe .invoice-muted {
          color: #4b5563 !important;
          opacity: 1 !important;
        }

        .invoice-page-safe .invoice-action,
        .invoice-page-safe .invoice-status-pill {
          color: #111827 !important;
          opacity: 1 !important;
          text-shadow: none !important;
        }

        .invoice-page-safe svg {
          color: currentColor !important;
          opacity: 1 !important;
        }
      `}</style>
      <Nav />
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker text-[#111827]">חוכמת חשבוניות</div>
          <h1 className="text-[#111827]">חשבוניות</h1>
          <p className="text-[17px] font-medium leading-8 text-[#111827]">מעקב, סינון וסריקה של חשבוניות מכל הלקוחות.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/dashboard/invoice-import"
            className="inline-flex min-w-40 items-center justify-center gap-2 rounded-2xl border border-[#059669] bg-[#ECFDF5] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#D1FAE5]"
          >
            <UploadCloud className="h-4 w-4" />
            ייבוא מקובץ
          </Link>
          <button className="inline-flex min-w-40 items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-[#DBEAFE] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:bg-[#E5E7EB]" onClick={scanInvoices} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {scanning ? "סורק..." : "סרוק חשבוניות"}
          </button>
        </div>
      </div>
      {visibleMessage && (
        <div className={`mb-6 rounded-2xl border p-4 text-base font-medium leading-7 ${messageClasses}`}>
          <div>{visibleMessage}</div>
          {scanProgress && <div className="mt-1 flex items-center gap-2 text-base font-semibold text-[#111827]"><Loader2 className="h-4 w-4 animate-spin" />{scanProgress}</div>}
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" dir="rtl">
        <Metric label="חשבוניות החודש" value={thisMonth.length} tone="text-[#111827]" />
        <Metric label="ממתין לתשלום" value={`₪${pending.toLocaleString("he-IL")}`} tone="text-[#111827]" />
        <Metric label="שולם" value={`₪${paid.toLocaleString("he-IL")}`} tone="text-[#111827]" />
        <Metric label="באיחור" value={overdue} tone="text-[#111827]" />
      </div>

      <div className="mb-5 flex flex-wrap gap-2" dir="rtl" aria-label="סינון חשבוניות לפי סטטוס בדיקה">
        {reviewTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
              reviewStatus === tab.value
                ? "border-[#1D4ED8] bg-[#DBEAFE] text-[#111827]"
                : "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]"
            }`}
            onClick={() => setReviewStatus(tab.value)}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="rounded-full border border-[#D97706] bg-[#FEF3C7] px-4 py-2 text-sm font-black text-[#111827] transition hover:bg-[#FDE68A]"
          onClick={() => {
            setReviewStatus("needs_review");
            setClientId("all");
            setSearch("");
            setFromDate("");
            setToDate("");
            setSelectedInvoiceIds(new Set());
          }}
        >
          סינון מהיר: דורש בדיקה
        </button>
      </div>

      <div className="invoice-panel mb-5 rounded-2xl border border-[#E5E7EB] bg-white p-5 text-[#111827] shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-[17px] font-black text-[#111827]"><Filter className="h-5 w-5" />סינון וחיפוש</div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-base font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="all">כל הלקוחות</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4B5563]" />
            <input className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 pr-10 font-sans text-base font-semibold text-[#111827] shadow-sm outline-none placeholder:text-[#4B5563] focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]" placeholder="חיפוש לפי מספר חשבונית" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <input className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-base font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-base font-semibold text-[#111827] shadow-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE]" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      <div className="invoice-panel mb-5 flex flex-col gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm sm:flex-row sm:items-center sm:justify-between" dir="rtl">
        <label className="inline-flex items-center gap-2 text-base font-black text-[#111827]">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAllVisible}
            disabled={filtered.length === 0 || bulkDeleting}
            className="h-5 w-5 rounded border-[#9CA3AF]"
          />
          בחר הכל בעמוד
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-[#111827]">נבחרו {selectedVisibleInvoices.length} חשבוניות</span>
          <button
            type="button"
            className="invoice-action rounded-2xl border border-[#B91C1C] bg-[#FEE2E2] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#FECACA] disabled:cursor-not-allowed disabled:bg-[#E5E7EB]"
            onClick={deleteSelectedInvoices}
            disabled={selectedVisibleInvoices.length === 0 || bulkDeleting}
          >
            {bulkDeleting ? "מוחק נבחרים..." : "מחק נבחרים"}
          </button>
        </div>
      </div>

      {monthsLoading && (
        <div className="invoice-panel mb-5 flex items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white p-8 text-[#111827] shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-base font-bold">טוען חודשים...</span>
        </div>
      )}

      {!monthsLoading && months.length === 0 && junkInvoices.length === 0 && (
        <div className="invoice-panel rounded-2xl border border-[#E5E7EB] bg-white p-5 text-center text-[#111827] shadow-sm">
          <h2 className="text-[#111827]">לא נמצאו חשבוניות</h2>
          <p className="invoice-muted mt-2 text-base font-bold text-[#4B5563]">
            נסה לשנות את הסינון או להפעיל סריקת חשבוניות ללקוחות עם ג׳ימייל מחובר.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {months.map((month) => {
          const key = monthKey(month.year, month.month);
          const isExpanded = expandedMonths.has(key);
          const monthInvoices = monthInvoicesForDisplay(key);
          const totals = formatMonthTotalsSummary(month.totalsByCurrency);
          const isLoading = loadingMonth.has(key);

          return (
            <section key={key} className="invoice-panel overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 py-4 text-right transition hover:bg-[#F8FAFC] md:px-5"
                onClick={() => toggleMonthExpanded(key)}
                aria-expanded={isExpanded}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronLeft className="h-5 w-5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-lg font-black text-[#111827]">{formatMonthTitle(month.year, month.month)}</div>
                    <div className="mt-1 text-sm font-semibold text-[#4B5563]">
                      {month.count} חשבוניות
                      {totals.extra ? (
                        <span className="mr-2">
                          · {totals.main}
                          <span className="mr-1 text-xs font-bold text-[#6B7280]">{totals.extra}</span>
                        </span>
                      ) : (
                        <span className="mr-2"> · {totals.main}</span>
                      )}
                    </div>
                  </div>
                </div>
                {isLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#4B5563]" />}
              </button>

              {isExpanded && (
                <div className="p-4 md:p-5">
                  {isLoading && monthInvoices.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm font-bold text-[#4B5563]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      טוען חשבוניות...
                    </div>
                  ) : monthInvoices.length === 0 ? (
                    <p className="py-4 text-center text-sm font-bold text-[#4B5563]">אין חשבוניות להצגה בחודש זה</p>
                  ) : (
                    <>
                      <InvoiceMobileList
                        invoices={monthInvoices}
                        selectedInvoiceIds={selectedInvoiceIds}
                        bulkDeleting={bulkDeleting}
                        deletingId={deletingId}
                        onSelect={setSelected}
                        onToggleSelection={toggleInvoiceSelection}
                        onToggleStatus={toggleStatus}
                        onApprove={approveInvoice}
                        onDelete={deleteInvoice}
                      />
                      <InvoiceDesktopList
                        invoices={monthInvoices}
                        selectedInvoiceIds={selectedInvoiceIds}
                        bulkDeleting={bulkDeleting}
                        deletingId={deletingId}
                        allVisibleSelected={false}
                        onSelect={setSelected}
                        onToggleSelection={toggleInvoiceSelection}
                        onToggleSelectAllVisible={() => {}}
                        onToggleStatus={toggleStatus}
                        onApprove={approveInvoice}
                        onDelete={deleteInvoice}
                        showSelectAll={false}
                      />
                    </>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {junkInvoices.length > 0 && (
        <section className="invoice-panel mt-6 overflow-hidden rounded-2xl border border-[#D97706] bg-white shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 bg-[#FEF3C7] px-4 py-4 text-right transition hover:bg-[#FDE68A] md:px-5"
            onClick={() => setJunkDrawerExpanded((current) => !current)}
            aria-expanded={junkDrawerExpanded}
          >
            <div className="flex items-center gap-3">
              {junkDrawerExpanded ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronLeft className="h-5 w-5 shrink-0" />}
              <span className="text-lg font-black text-[#111827]">דורש בדיקה ידנית ({junkInvoices.length})</span>
            </div>
          </button>
          {junkDrawerExpanded && (
            <div className="border-t border-[#FDE68A] p-4 md:p-5">
              <InvoiceMobileList
                invoices={junkInvoices}
                selectedInvoiceIds={selectedInvoiceIds}
                bulkDeleting={bulkDeleting}
                deletingId={deletingId}
                onSelect={setSelected}
                onToggleSelection={toggleInvoiceSelection}
                onToggleStatus={toggleStatus}
                onApprove={approveInvoice}
                onDelete={deleteInvoice}
              />
              <InvoiceDesktopList
                invoices={junkInvoices}
                selectedInvoiceIds={selectedInvoiceIds}
                bulkDeleting={bulkDeleting}
                deletingId={deletingId}
                allVisibleSelected={false}
                onSelect={setSelected}
                onToggleSelection={toggleInvoiceSelection}
                onToggleSelectAllVisible={() => {}}
                onToggleStatus={toggleStatus}
                onApprove={approveInvoice}
                onDelete={deleteInvoice}
                showSelectAll={false}
              />
            </div>
          )}
        </section>
      )}

      {selected && (
        <div className="fixed inset-0 z-[110] overflow-y-auto bg-slate-950/75 p-0 backdrop-blur-sm sm:grid sm:place-items-center sm:p-6" role="presentation" onClick={() => setSelected(null)}>
          <div className="invoice-modal relative min-h-screen w-full overflow-y-auto rounded-none border border-[#E5E7EB] bg-white p-4 text-right text-[#111827] shadow-2xl animate-[toastSlide_.25s_ease] sm:max-h-[92vh] sm:min-h-0 sm:max-w-4xl sm:rounded-[28px] sm:p-7" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="invoice-details-title" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="invoice-action sticky top-3 z-20 mr-auto grid h-11 w-11 place-items-center rounded-full border border-[#E5E7EB] bg-white text-2xl font-black leading-none text-[#111827] shadow-sm transition hover:bg-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] sm:absolute sm:left-4 sm:top-4"
              aria-label="סגור חלון פרטי חשבונית"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <div className="mb-6 flex flex-col gap-4 border-b border-[#E5E7EB] pb-5 pl-12 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] text-[#111827]">
                  <FileText className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-extrabold uppercase tracking-wide text-[#111827]">פרטי חשבונית</p>
                  <h2 id="invoice-details-title" className="mt-1 text-2xl font-black leading-tight text-[#111827] sm:text-3xl">
                    {selected.supplierName || selected.client?.name || MISSING_VALUE}
                  </h2>
                  <p className="mt-2 text-base font-semibold leading-7 text-[#111827]">
                    {selected.reviewStatus === "needs_review" ? "חשבונית שמורה וממתינה לאישור" : reviewStatusLabels[selected.reviewStatus ?? "approved"]}
                  </p>
                </div>
              </div>
              <span className={`invoice-status-pill w-fit rounded-full border px-4 py-2 text-sm font-black text-[#111827] ${
                selected.reviewStatus === "needs_review"
                  ? "border-[#D97706] bg-[#FEF3C7]"
                  : selected.reviewStatus === "rejected"
                    ? "border-[#DC2626] bg-[#FEE2E2]"
                    : "border-[#059669] bg-[#D1FAE5]"
              }`}>
                {reviewStatusLabels[selected.reviewStatus ?? "approved"]}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <DetailCard label="ספק" value={selected.supplierName || MISSING_VALUE} />
              <DetailCard label="סכום" value={formatInvoiceAmount(selected)} highlight />
              <DetailCard label="מספר חשבונית" value={selected.invoiceNumber || MISSING_VALUE} />
              <DetailCard label="תאריך" value={formatInvoiceDate(selected.date)} />
              <DetailCard label="מקור" value={sourceLabel(selected.source)} />
              <DetailCard label="סטטוס" value={reviewBadgeLabel(selected)} />
              <div className="invoice-detail-surface rounded-2xl border border-[#E5E7EB] bg-white p-4 sm:col-span-2">
                <div className="mb-2 text-sm font-black text-[#111827]">קישור למסמך</div>
                {documentDriveUrl(selected) ? (
                  <a className="invoice-action inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-[#DBEAFE] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#BFDBFE] sm:w-auto" href={documentDriveUrl(selected) ?? undefined} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />פתח מסמך בדרייב
                  </a>
                ) : (
                  <div className="invoice-muted break-words text-lg font-black leading-7 text-[#4B5563]">המסמך עדיין לא נשמר בדרייב</div>
                )}
              </div>
            </div>

            {selected.description && (
              <div className="invoice-detail-surface mt-5 rounded-2xl border border-[#E5E7EB] bg-white p-4">
                <div className="mb-2 text-sm font-black text-[#111827]">תיאור</div>
                <p className="whitespace-pre-wrap break-words text-base font-semibold leading-8 text-[#111827]">{selected.description}</p>
              </div>
            )}

            <div className="invoice-detail-surface mt-5 rounded-2xl border border-[#E5E7EB] bg-white p-4">
              <div className="mb-2 text-sm font-black text-[#111827]">הערות מערכת</div>
              <p className="whitespace-pre-wrap break-words text-base font-semibold leading-8 text-[#111827]">{systemNoteForInvoice(selected)}</p>
            </div>

            {selected.gmailMessageLink && (
              <div className="mt-5">
                <a className="invoice-action inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-white px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#EFF6FF] sm:w-auto" href={selected.gmailMessageLink} target="_blank" rel="noreferrer">
                  פתח מייל מקור
                </a>
              </div>
            )}

            {documentDriveUrl(selected) && (
              <div className="mt-6">
                <div className="mb-2 text-sm font-black text-[#111827]">תצוגה מקדימה</div>
                <iframe className="h-[50vh] w-full rounded-2xl border border-[#E5E7EB] bg-white shadow-inner sm:h-[55vh] sm:min-h-80" src={toDrivePreviewUrl(documentDriveUrl(selected)!)} title="תצוגה מקדימה של חשבונית" />
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-[#E5E7EB] pt-5 sm:flex-row sm:justify-between">
              <button type="button" className="invoice-action min-h-[44px] w-full rounded-2xl border border-[#E5E7EB] bg-white px-5 py-3 text-base font-black text-[#111827] transition hover:bg-[#F3F4F6] sm:w-auto" onClick={() => setSelected(null)}>סגור</button>
              <button type="button" className="invoice-action min-h-[44px] w-full rounded-2xl border border-[#B91C1C] bg-[#FEE2E2] px-5 py-3 text-base font-black text-[#111827] transition hover:bg-[#FECACA] sm:w-auto" onClick={() => deleteInvoice(selected)} disabled={deletingId === selected.id}>
                {deletingId === selected.id ? "מוחק..." : "מחק חשבונית"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="invoice-metric rounded-2xl border border-[#E5E7EB] bg-white p-5 text-[#111827] shadow-sm">
      <div className="text-sm font-black text-[#111827]">{label}</div>
      <div className={`mt-2 text-3xl font-black ${tone}`}>{value}</div>
    </div>
  );
}

type InvoiceListProps = {
  invoices: Invoice[];
  selectedInvoiceIds: Set<string>;
  bulkDeleting: boolean;
  deletingId: string | null;
  onSelect: (invoice: Invoice) => void;
  onToggleSelection: (invoiceId: string) => void;
  onToggleStatus: (invoice: Invoice) => void;
  onApprove: (invoice: Invoice) => void;
  onDelete: (invoice: Invoice) => void;
};

type InvoiceDesktopListProps = InvoiceListProps & {
  allVisibleSelected: boolean;
  onToggleSelectAllVisible: () => void;
  showSelectAll: boolean;
};

function InvoiceMobileList({
  invoices,
  selectedInvoiceIds,
  bulkDeleting,
  deletingId,
  onSelect,
  onToggleSelection,
  onToggleStatus,
  onApprove,
  onDelete,
}: InvoiceListProps) {
  return (
    <div className="grid gap-4 md:hidden">
      {invoices.map((invoice) => (
        <div key={invoice.id} className="invoice-mobile-row space-y-2 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <input
                type="checkbox"
                checked={selectedInvoiceIds.has(invoice.id)}
                onChange={() => onToggleSelection(invoice.id)}
                disabled={bulkDeleting}
                className="mt-1 h-5 w-5 shrink-0 rounded border-[#9CA3AF]"
                aria-label="בחר חשבונית"
              />
              <button type="button" className="min-w-0 flex-1 text-right" onClick={() => onSelect(invoice)}>
                <div className="truncate text-base font-semibold text-[#111827]" title={invoice.client?.name ?? invoice.supplierName ?? MISSING_VALUE}>{invoice.client?.name ?? invoice.supplierName ?? MISSING_VALUE}</div>
              </button>
            </div>
            <span className={`invoice-status-pill inline-flex shrink-0 items-center justify-center rounded-full px-3 py-1 text-sm font-black ${statusBadgeClass(invoice)}`}>
              {reviewBadgeLabel(invoice)}
            </span>
          </div>
          <button type="button" className="block w-full min-w-0 text-right" onClick={() => onSelect(invoice)}>
            <div className="truncate text-sm font-normal text-[#6B7280]" title={`${formatInvoiceDate(invoice.date)} · ${invoiceMetaLine(invoice)}`}>{formatInvoiceDate(invoice.date)} · {invoiceMetaLine(invoice)}</div>
          </button>
          {displayInvoiceDescription(invoice) !== "—" && (
            <button type="button" className="block w-full min-w-0 text-right" onClick={() => onSelect(invoice)}>
              <div className="truncate text-base font-semibold text-[#111827]" title={displayInvoiceDescription(invoice)}>{displayInvoiceDescription(invoice)}</div>
            </button>
          )}
          <div className="min-w-0 text-lg font-bold text-[#111827]">{formatInvoiceAmount(invoice)}</div>
          <div className="grid grid-cols-2 gap-2">
            {documentDriveUrl(invoice) && (
              <a className="invoice-action inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-xl border border-[#1D4ED8] bg-[#DBEAFE] px-3 py-2 text-sm font-semibold text-[#111827] transition hover:bg-[#BFDBFE]" href={documentDriveUrl(invoice) ?? undefined} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4 shrink-0" /><span className="truncate">פתח בדרייב</span>
              </a>
            )}
            {invoice.gmailMessageLink && (
              <a className="invoice-action inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-semibold text-[#111827] transition hover:bg-[#F3F4F6]" href={invoice.gmailMessageLink} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4 shrink-0" /><span className="truncate">פתח מייל</span>
              </a>
            )}
            {isPersistedInvoice(invoice) && (
              <button className="invoice-action min-h-[44px] min-w-0 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-semibold text-[#111827] transition hover:bg-[#F3F4F6]" onClick={() => onToggleStatus(invoice)}>
                <span className="truncate">{invoice.status === "paid" ? "סמן כממתינה" : "סמן כשולמה"}</span>
              </button>
            )}
            {invoice.reviewStatus === "needs_review" && (
              <button
                type="button"
                className="invoice-action inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-xl border border-[#059669] bg-[#ECFDF5] px-3 py-2 text-sm font-semibold text-[#059669] transition hover:bg-[#D1FAE5]"
                title="אשר חשבונית"
                onClick={() => onApprove(invoice)}
              >
                <Check className="h-4 w-4 shrink-0" />
                <span className="truncate">אשר</span>
              </button>
            )}
            <button className="invoice-action min-h-[44px] min-w-0 rounded-xl border border-[#B91C1C] bg-[#FEE2E2] px-3 py-2 text-sm font-semibold text-[#111827] transition hover:bg-[#FECACA]" onClick={() => onDelete(invoice)} disabled={deletingId === invoice.id}>
              <span className="truncate">{deletingId === invoice.id ? "מוחק..." : "מחק"}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function InvoiceDesktopList({
  invoices,
  selectedInvoiceIds,
  bulkDeleting,
  deletingId,
  allVisibleSelected,
  onSelect,
  onToggleSelection,
  onToggleSelectAllVisible,
  onToggleStatus,
  onApprove,
  onDelete,
  showSelectAll,
}: InvoiceDesktopListProps) {
  return (
    <div className="invoice-table-wrap hidden max-w-full overflow-x-auto rounded-2xl border border-[#E5E7EB] bg-white pl-2 shadow-sm md:block">
      <table className="w-full table-fixed bg-white text-[#111827]">
        <thead className="bg-[#F3F4F6]">
          <tr className="border-b border-[#E5E7EB]">
            <th className="w-[4%] text-base font-black text-[#111827]">
              {showSelectAll ? (
                <input type="checkbox" aria-label="בחר הכל בעמוד" checked={allVisibleSelected} onChange={onToggleSelectAllVisible} disabled={invoices.length === 0 || bulkDeleting} className="h-5 w-5 rounded border-[#9CA3AF]" />
              ) : null}
            </th>
            <th className="w-[20%] text-base font-black text-[#111827]">לקוח/ספק</th>
            <th className="w-[10%] text-base font-black text-[#111827]">תאריך</th>
            <th className="w-[30%] text-base font-black text-[#111827]">תיאור</th>
            <th className="w-[10%] text-base font-black text-[#111827]">סכום</th>
            <th className="w-[11%] text-base font-black text-[#111827]">סטטוס</th>
            <th className="w-[15%] text-base font-black text-[#111827]">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} onClick={() => onSelect(invoice)} className="cursor-pointer border-b border-[#E5E7EB] bg-white transition hover:bg-[#F8FAFC]">
              <td className="py-4">
                <input
                  type="checkbox"
                  aria-label="בחר חשבונית"
                  checked={selectedInvoiceIds.has(invoice.id)}
                  onChange={() => onToggleSelection(invoice.id)}
                  onClick={(event) => event.stopPropagation()}
                  disabled={bulkDeleting}
                  className="h-5 w-5 rounded border-[#9CA3AF]"
                />
              </td>
              <td className="py-4">
                <div className="flex max-w-full items-center gap-2 text-[#111827]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E5E7EB] bg-[#F3F4F6] text-sm font-black text-[#111827]">{(invoice.client?.name ?? invoice.supplierName ?? "בדיקה").slice(0, 2)}</span>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold" title={invoice.client?.name ?? invoice.supplierName ?? MISSING_VALUE}>{invoice.client?.name ?? invoice.supplierName ?? MISSING_VALUE}</div>
                    <div className="truncate text-xs font-normal text-[#9CA3AF]" title={invoiceMetaLine(invoice)}>{invoiceMetaLine(invoice)}</div>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap py-4 text-base font-normal text-[#111827]">{formatInvoiceDate(invoice.date)}</td>
              <td className="min-w-0 py-4 text-[#111827]">
                <div className="truncate text-base font-semibold" title={displayInvoiceDescription(invoice)}>{displayInvoiceDescription(invoice)}</div>
                <div className="truncate text-xs font-normal text-[#9CA3AF]" title={systemNoteForInvoice(invoice)}>{systemNoteForInvoice(invoice)}</div>
              </td>
              <td className="whitespace-nowrap py-4 text-base font-bold text-[#111827]">{formatInvoiceAmount(invoice)}</td>
              <td className="whitespace-nowrap py-4"><span className={`invoice-status-pill inline-flex items-center justify-center rounded-full px-3 py-1 text-sm font-black ${statusBadgeClass(invoice)}`}>{reviewBadgeLabel(invoice)}</span></td>
              <td className="py-4">
                <div className="flex min-w-0 flex-nowrap gap-1">
                  {documentDriveUrl(invoice) && <a className="invoice-action inline-flex min-w-0 items-center justify-center gap-1 rounded-lg border border-[#1D4ED8] bg-[#DBEAFE] px-1.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-[#BFDBFE]" href={documentDriveUrl(invoice) ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Download className="h-3 w-3" />דרייב</a>}
                  {invoice.gmailMessageLink && <a className="invoice-action rounded-lg border border-[#E5E7EB] bg-white px-1.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-[#F3F4F6]" href={invoice.gmailMessageLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>מייל</a>}
                  {isPersistedInvoice(invoice) && <button className="invoice-action rounded-lg border border-[#E5E7EB] bg-white px-1.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-[#F3F4F6]" onClick={(e) => { e.stopPropagation(); onToggleStatus(invoice); }}>{invoice.status === "paid" ? "ממתינה" : "שולמה"}</button>}
                  {invoice.reviewStatus === "needs_review" && (
                    <button
                      type="button"
                      className="invoice-action inline-flex items-center justify-center rounded-lg border border-[#059669] bg-[#ECFDF5] px-1.5 py-1 text-xs font-bold text-[#059669] transition hover:bg-[#D1FAE5]"
                      title="אשר חשבונית"
                      onClick={(e) => { e.stopPropagation(); onApprove(invoice); }}
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  )}
                  <button className="invoice-action rounded-lg border border-[#B91C1C] bg-[#FEE2E2] px-1.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-[#FECACA]" onClick={(e) => { e.stopPropagation(); onDelete(invoice); }} disabled={deletingId === invoice.id}>{deletingId === invoice.id ? "מוחק..." : "מחק"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  const isMissing = value === MISSING_VALUE;

  return (
    <div className={`invoice-detail-surface rounded-2xl border p-4 ${highlight ? "border-[#1D4ED8] bg-white" : "border-[#E5E7EB] bg-white"}`}>
      <div className="mb-2 text-sm font-black text-[#111827]">{label}</div>
      <div className={`break-words text-lg font-black leading-7 ${isMissing ? "invoice-muted text-[#4B5563]" : "text-[#111827]"}`}>{value}</div>
    </div>
  );
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatMonthTitle(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
}

function formatMonthTotalsSummary(totalsByCurrency: Record<string, number>) {
  const ils = totalsByCurrency.ILS ?? 0;
  const main = formatCurrency(ils, "ILS");
  const foreignParts = Object.entries(totalsByCurrency)
    .filter(([currency, amount]) => currency !== "ILS" && Number.isFinite(amount) && amount > 0)
    .map(([currency, amount]) => {
      const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
      const symbol = symbols[currency] ?? currency;
      return `+ ${symbol}${amount.toLocaleString("he-IL")}`;
    });
  return { main, extra: foreignParts.join(" ") };
}

function isJunkInvoice(invoice: Invoice) {
  const supplier = invoice.supplierName?.trim() ?? "";
  if (supplier.startsWith("Unknown") || supplier.startsWith("לא ידוע")) return true;
  if (invoice.amount === 1_000_000 || invoice.amount === 0) return true;
  const parsedDate = new Date(invoice.date);
  if (!Number.isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > new Date().getFullYear() + 1) return true;
  return false;
}

function formatInvoiceAmount(invoice: Invoice) {
  if (!Number.isFinite(invoice.amount)) return MISSING_VALUE;
  return formatCurrency(invoice.amount, invoice.currency);
}

function formatInvoiceDate(date: string | null | undefined) {
  if (!date) return MISSING_VALUE;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return MISSING_VALUE;
  return parsed.toLocaleDateString("he-IL");
}

function displayInvoiceDescription(invoice: Invoice) {
  const description = invoice.description?.trim();
  if (!description || description.startsWith("/") || /^https?:\/\//i.test(description) || description.includes("#inbox")) return "—";
  return description;
}

function invoiceMetaLine(invoice: Invoice) {
  const parts = [sourceLabel(invoice.source)];
  const invoiceNumber = invoice.invoiceNumber?.trim();
  if (invoiceNumber && invoiceNumber !== MISSING_VALUE) parts.push(`מס׳ ${invoiceNumber}`);
  return parts.join(" · ");
}

function formatCurrency(amount: number, currency: string) {
  const symbols: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  return `${symbols[currency] ?? currency} ${amount.toLocaleString("he-IL")}`;
}

function isPersistedInvoice(invoice: Invoice) {
  return !invoice.source || invoice.source === "invoice";
}

function invoiceDeleteTarget(invoice: Invoice) {
  if (invoice.source === "gmail_scan_item") {
    return `/api/gmail-scan-items/${invoice.reviewSourceId ?? invoice.id.replace(/^gmail-scan:/, "")}`;
  }
  if (invoice.source === "financial_document_review") {
    return `/api/document-reviews/${invoice.reviewSourceId ?? invoice.id.replace(/^document-review:/, "")}`;
  }
  return `/api/invoices/${invoice.id}`;
}

function invoiceDeleteSucceeded(invoice: Invoice, result: InvoiceDeleteResponse) {
  if (invoice.source === "gmail_scan_item") {
    return (result.deleted?.gmailScanItems ?? 0) > 0 && (result.verification?.after?.gmailScanItems ?? 0) === 0;
  }
  if (invoice.source === "financial_document_review") {
    return (result.deleted?.documentReviews ?? 0) > 0 && (result.verification?.after?.documentReviews ?? 0) === 0;
  }
  const afterInvoices = result.verification?.after?.invoices ?? result.verification?.afterCount ?? 0;
  return (result.deleted?.invoices ?? 0) > 0 && afterInvoices === 0;
}

function reviewBadgeLabel(invoice: Invoice) {
  return reviewStatusLabels[invoice.reviewStatus ?? "approved"];
}

function systemNoteForInvoice(invoice: Invoice) {
  const reviewStatus = invoice.reviewStatus ?? "approved";
  const rawReason = normalizeInternalReason(invoice.decisionReason);

  if (reviewStatus === "rejected") return "המסמך נדחה לאחר בדיקה";
  if (rawReason.includes("receipt") || rawReason.includes("קבלה")) return "ייתכן שמדובר בקבלה";

  if (reviewStatus === "needs_review") {
    if (rawReason.includes("money direction unsure")) return "המערכת לא בטוחה בכיוון התשלום";
    if (rawReason.includes("no valid amount") || rawReason.includes("missing amount") || rawReason.includes("amount") || rawReason.includes("total") || rawReason.includes("sum")) return "לא זוהה סכום תקין";
    if (rawReason.includes("confidence below") || rawReason.includes("medium confidence")) return "רמת ודאות בינונית";
    if (rawReason.includes("held for review") || rawReason.includes("needs review") || rawReason.includes("classifier") || rawReason.includes("unknown or unusable supplier")) return "נדרש אימות ידני";
    if (!Number.isFinite(invoice.amount) || invoice.amount <= 0) return "לא זוהה סכום תקין";

    if (!invoice.supplierName && !invoice.client?.name) return "נדרש אימות ידני של הספק";
    if (!invoice.invoiceNumber) return "נדרש אימות ידני של מספר החשבונית";
    if (!invoice.date || Number.isNaN(new Date(invoice.date).getTime())) return "נדרש אימות ידני של תאריך החשבונית";

    return "נדרש אימות ידני";
  }

  return "זוהתה חשבונית בביטחון גבוה";
}

function normalizeInternalReason(reason: string | null | undefined) {
  return (reason ?? "")
    .toLowerCase()
    .replace(/[_:.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function statusBadgeClass(invoice: Invoice) {
  const reviewStatus = invoice.reviewStatus ?? "approved";
  if (reviewStatus === "needs_review") return "border border-[#D97706] bg-[#FEF3C7] text-[#111827]";
  if (reviewStatus === "rejected") return "border border-[#DC2626] bg-[#FEE2E2] text-[#111827]";
  return "border border-[#059669] bg-[#D1FAE5] text-[#111827]";
}

function sourceLabel(source: Invoice["source"] | undefined) {
  if (source === "gmail_scan_item") return "סריקת מייל";
  if (source === "financial_document_review") return "בדיקת מסמך";
  return "חשבונית מאושרת";
}

function documentDriveUrl(invoice: Invoice) {
  return invoice.driveFileUrl || invoice.driveUrl || null;
}

function toDrivePreviewUrl(url: string) {
  return url.replace(/\/view(?:\?.*)?$/, "/preview");
}
