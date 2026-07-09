"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { InvoicesFiltersCard, InvoicesReviewTabs } from "@/components/invoices";
import type { ClientItem, Invoice, InvoiceReviewStatus } from "@/components/invoices";
import {
  AppShell,
  Button,
  Card,
  EmptyState,
  KpiCard,
  MessageBanner,
  PageTitle,
  SkeletonCard,
  StatusBadge,
} from "@/components/natalie-ui";
import { useI18n } from "@/i18n";
import { apiFetch } from "@/lib/api";
import { approvalErrorHebrew } from "@/lib/documents/presentation";
import { buildFallbackMonthGroups } from "@/lib/invoices/monthGrouping";
import { removeRowAfterAction } from "@/lib/invoices/animatedRemoval";
import { formatAmount } from "@/lib/format/amount";
import { isLikelyJunkSupplierNameLocal } from "@/lib/junkSupplier";
import { Check, ChevronDown, ChevronLeft, Download, FileText, Loader2, RefreshCcw, UploadCloud } from "lucide-react";
import { buttonVariants } from "@/components/natalie-ui/tokens";

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
// תוויות "חסר" מובחנות — במקום אותה מילה "לא זוהה" לשלושה שדות שונים.
const MISSING_SUPPLIER = "ספק לא זוהה";
const MISSING_NUMBER = "ללא מספר";
const MISSING_DATE = "ללא תאריך";

/** מפתח תאריך בטוח לסינון — הטיפוס אומר string אבל רשומות GSI/FDR עלולות
 *  להגיע בלי תאריך; בלי ההגנה הזו invoice.date.slice קורס. */
function invoiceDateKey(invoice: { date?: string | null }): string {
  return typeof invoice.date === "string" ? invoice.date.slice(0, 10) : "";
}
const REMOVAL_ANIMATION_MS = 250;

export default function InvoicesPage() {
  const { t, dir, language } = useI18n();
  const locale = language === "he" ? "he-IL" : "en-US";
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
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const skipFilterRefresh = useRef(true);

  const reviewTabLabels = useMemo(
    () => ({
      all: t("invoicesDesign.reviewAll"),
      approved: t("invoicesDesign.reviewApproved"),
      needs_review: t("invoicesDesign.reviewNeedsReview"),
      rejected: t("invoicesDesign.reviewRejected"),
    }),
    [t]
  );

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
    if (allKeys.length === 0) {
      const fallback = await apiFetch<InvoicesResponse>(`/api/invoices${querySuffix}`);
      const grouped = buildFallbackMonthGroups(fallback.invoices);
      setMonths(grouped.months);
      setInvoicesByMonth(grouped.invoicesByMonth);
      setExpandedMonths(new Set(grouped.months.map((month) => monthKey(month.year, month.month))));
      return;
    }
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
    const date = invoiceDateKey(invoice);
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
      const date = invoiceDateKey(invoice);
      return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    };
    const monthKeys = months.map((month) => monthKey(month.year, month.month));
    for (const key of monthKeys) {
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
    if (!invoice.date) return false;
    const date = new Date(invoice.date);
    if (Number.isNaN(date.getTime())) return false;
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const paid = filtered
    .filter((invoice) => invoice.status === "paid" && invoice.amount != null && invoice.amount > 0)
    .reduce((sum, invoice) => sum + invoice.amount!, 0);
  const pending = filtered
    .filter((invoice) => invoice.status !== "paid" && invoice.amount != null && invoice.amount > 0)
    .reduce((sum, invoice) => sum + invoice.amount!, 0);
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

  function handleAnimatedApprove(invoice: Invoice) {
    if (invoice.source === "invoice" || isPersistedInvoice(invoice)) return;
    setMessage("");
    void removeRowAfterAction({
      performAction: () => approveInvoiceRequest(invoice),
      beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
      waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
      finalize: async () => {
        if (selected?.id === invoice.id) setSelected(null);
        await refreshMonthsAndInvoices(Object.keys(invoicesByMonth));
        setMessageTone("success");
        setMessage("החשבונית אושרה");
      },
      endExitAnimation: () =>
        setRemovingIds((current) => {
          const next = new Set(current);
          next.delete(invoice.id);
          return next;
        }),
      reportError: (err) => {
        setMessageTone("error");
        setMessage(err instanceof Error ? approvalErrorHebrew(err.message) : "אישור החשבונית נכשל");
      },
    });
  }

  async function approveInvoiceRequest(invoice: Invoice): Promise<void> {
    if (invoice.source === "financial_document_review") {
      const id = invoice.reviewSourceId ?? invoice.id.replace(/^document-review:/, "");
      await apiFetch(`/api/document-reviews/${id}/approve`, { method: "POST" });
      return;
    }
    if (invoice.source === "gmail_scan_item") {
      const id = invoice.reviewSourceId ?? invoice.id.replace(/^gmail-scan:/, "");
      await apiFetch(`/api/gmail-scan-items/${id}/approve`, { method: "POST" });
      return;
    }
    throw new Error("לא ניתן לאשר חשבונית מסוג זה");
  }

  async function deleteInvoice(invoice: Invoice) {
    const confirmed = window.confirm("האם למחוק את החשבונית?");
    if (!confirmed) return;
    setDeletingId(invoice.id);
    setMessageTone("info");
    setMessage("");
    let result: InvoiceDeleteResponse | null = null;
    try {
      await removeRowAfterAction({
        performAction: async () => {
          result = await deleteInvoiceRecord(invoice);
        },
        beginExitAnimation: () => setRemovingIds((current) => new Set(current).add(invoice.id)),
        waitForExitAnimation: () => new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS)),
        finalize: async () => {
          setSelected(null);
          setSelectedInvoiceIds((current) => {
            const next = new Set(current);
            next.delete(invoice.id);
            return next;
          });
          removeInvoiceFromLocalState(invoice.id);
          await refreshMonthsAndInvoices(Object.keys(invoicesByMonth));
          setMessageTone("success");
          setMessage(`החשבונית נמחקה. נותקו ${result?.unlinked?.bankTransactions ?? 0} התאמות בנק.`);
        },
        endExitAnimation: () =>
          setRemovingIds((current) => {
            const next = new Set(current);
            next.delete(invoice.id);
            return next;
          }),
        reportError: (err) => {
          setMessageTone("error");
          setMessage(err instanceof Error ? `מחיקת החשבונית נכשלה: ${err.message}` : "מחיקת החשבונית נכשלה");
        },
      });
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
    // מחיקה סדרתית — עוקבים אחרי מה שנמחק בפועל כדי לדווח מצב חלקי במדויק
    // במקום כשל שקט שמשאיר חלק מהרשומות מחוקות והמשתמש לא יודע כמה.
    // אנימציית ההסרה מופעלת רק אחרי שהמחיקה של אותה שורה אושרה בשרת,
    // כדי ששורה שהמחיקה שלה נכשלה לא תיעלם מהמסך.
    const total = selectedVisibleInvoices.length;
    const deletedIds = new Set<string>();
    let failure: unknown = null;
    try {
      for (const invoice of selectedVisibleInvoices) {
        setDeletingId(invoice.id);
        try {
          await deleteInvoiceRecord(invoice);
          deletedIds.add(invoice.id);
          setRemovingIds((current) => new Set(current).add(invoice.id));
        } catch (err) {
          failure = err;
          break;
        }
      }
      if (deletedIds.size > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS));
      }
    } finally {
      setSelected((current) => (current && deletedIds.has(current.id) ? null : current));
      setSelectedInvoiceIds(new Set());
      for (const id of deletedIds) removeInvoiceFromLocalState(id);
      await refreshMonthsAndInvoices(Object.keys(invoicesByMonth)).catch(() => undefined);
      if (failure) {
        setMessageTone("error");
        const reason = failure instanceof Error ? failure.message : "שגיאה לא ידועה";
        setMessage(
          deletedIds.size > 0
            ? `נמחקו ${deletedIds.size} מתוך ${total} חשבוניות. השאר לא נמחקו (${reason}). נסה שוב את הנותרות.`
            : `מחיקת החשבוניות נכשלה: ${reason}`
        );
      } else {
        setMessageTone("success");
        setMessage(`${deletedIds.size} חשבוניות נמחקו.`);
      }
      setDeletingId(null);
      setBulkDeleting(false);
      setRemovingIds(new Set());
    }
  }

  const visibleMessage = message.trim();
  const messageBannerTone = messageTone === "error" ? "error" : messageTone === "success" ? "success" : "info";

  return (
    <div dir={dir}>
      <AppShell
        pageTitle={<PageTitle title={t("invoicesDesign.title")} subtitle={t("invoicesDesign.subtitle")} />}
      >
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
            <Link
              href="/dashboard/invoice-import"
              className={`${buttonVariants.secondary} min-w-40 inline-flex items-center justify-center gap-2`}
            >
              <UploadCloud className="h-4 w-4" />
              {t("invoicesDesign.importFile")}
            </Link>
            <Button variant="primary" className="min-w-40" onClick={scanInvoices} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              {scanning ? t("invoicesDesign.scanning") : t("invoicesDesign.scanInvoices")}
            </Button>
          </div>
        </div>

        {visibleMessage ? (
          <MessageBanner tone={messageBannerTone} className="mb-6">
            <div>{visibleMessage}</div>
            {scanProgress ? (
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <Loader2 className="h-4 w-4 animate-spin" />
                {scanProgress}
              </div>
            ) : null}
          </MessageBanner>
        ) : null}

        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={t("invoicesDesign.kpiThisMonth")} value={String(thisMonth.length)} />
          <KpiCard label={t("invoicesDesign.kpiPending")} value={`₪${pending.toLocaleString(locale)}`} />
          <KpiCard label={t("invoicesDesign.kpiPaid")} value={`₪${paid.toLocaleString(locale)}`} />
          <KpiCard label={t("invoicesDesign.kpiOverdue")} value={String(overdue)} />
        </div>

        <div className="mb-5">
          <InvoicesReviewTabs
            value={reviewStatus}
            onChange={setReviewStatus}
            labels={reviewTabLabels}
            quickFilterLabel={t("invoicesDesign.quickFilterNeedsReview")}
            onQuickNeedsReview={() => {
              setReviewStatus("needs_review");
              setClientId("all");
              setSearch("");
              setFromDate("");
              setToDate("");
              setSelectedInvoiceIds(new Set());
            }}
          />
        </div>

        <div className="mb-5">
          <InvoicesFiltersCard
            title={t("invoicesDesign.filtersTitle")}
            clientId={clientId}
            clients={clients}
            allClientsLabel={t("invoicesDesign.allClients")}
            search={search}
            searchPlaceholder={t("invoicesDesign.searchPlaceholder")}
            fromDate={fromDate}
            toDate={toDate}
            fromLabel={t("invoicesDesign.fromDate")}
            toLabel={t("invoicesDesign.toDate")}
            onClientChange={setClientId}
            onSearchChange={setSearch}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
          />
        </div>

        <Card className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-base font-black text-[var(--natalie-text-primary,#0F172A)]">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              disabled={filtered.length === 0 || bulkDeleting}
              className="h-5 w-5 rounded border-[#9CA3AF]"
            />
            {t("invoicesDesign.selectAll")}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-[var(--natalie-text-muted,#64748B)]">
              {t("invoicesDesign.selectedCount", { count: String(selectedVisibleInvoices.length) })}
            </span>
            <Button variant="danger" onClick={deleteSelectedInvoices} disabled={selectedVisibleInvoices.length === 0 || bulkDeleting}>
              {bulkDeleting ? t("invoicesDesign.bulkDeleting") : t("invoicesDesign.bulkDelete")}
            </Button>
          </div>
        </Card>

        {monthsLoading ? <div className="mb-5"><SkeletonCard /></div> : null}

        {!monthsLoading && months.length === 0 && junkInvoices.length === 0 ? (
          <EmptyState title={t("invoicesDesign.emptyTitle")} description={t("invoicesDesign.emptyHint")} />
        ) : null}

      <div className="space-y-4">
        {months.map((month) => {
          const key = monthKey(month.year, month.month);
          const isExpanded = expandedMonths.has(key);
          const monthInvoices = monthInvoicesForDisplay(key);
          const totals = formatMonthTotalsSummary(month.totalsByCurrency);
          const isLoading = loadingMonth.has(key);

          return (
            <section key={key} className="rounded-2xl border border-[var(--natalie-card-border,#DBE5F4)] bg-[var(--natalie-card-bg,#ffffff)] shadow-sm">
              <button
                type="button"
                className="sticky top-0 z-10 flex w-full items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white/85 px-4 py-4 text-right backdrop-blur-sm transition hover:bg-white/95 md:px-5"
                onClick={() => toggleMonthExpanded(key)}
                aria-expanded={isExpanded}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" /> : <ChevronLeft className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" />}
                  <div className="min-w-0">
                    <div className="text-lg font-black text-[#111827]">{formatMonthTitle(month.year, month.month)}</div>
                    <div className="mt-1 text-sm font-medium text-[#6B7280]">
                      {month.count} חשבוניות
                      {totals.extra ? (
                        <span className="mr-2">
                          · {totals.main}
                          <span className="mr-1 text-xs font-normal text-[#9CA3AF]">{totals.extra}</span>
                        </span>
                      ) : (
                        <span className="mr-2"> · {totals.main}</span>
                      )}
                    </div>
                  </div>
                </div>
                {isLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#4B5563]" />}
              </button>

              <CollapsePanel open={isExpanded}>
                <div className="overflow-hidden p-4 md:p-5">
                  {isLoading && monthInvoices.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm font-bold text-[#4B5563]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      טוען חשבוניות...
                    </div>
                  ) : monthInvoices.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[#9CA3AF]">אין חשבוניות להצגה בחודש זה</p>
                  ) : (
                    <>
                      <InvoiceMobileList
                        invoices={monthInvoices}
                        selectedInvoiceIds={selectedInvoiceIds}
                        bulkDeleting={bulkDeleting}
                        deletingId={deletingId}
                        removingIds={removingIds}
                        onSelect={setSelected}
                        onToggleSelection={toggleInvoiceSelection}
                        onToggleStatus={toggleStatus}
                        onApprove={handleAnimatedApprove}
                        onDelete={deleteInvoice}
                      />
                      <InvoiceDesktopList
                        invoices={monthInvoices}
                        selectedInvoiceIds={selectedInvoiceIds}
                        bulkDeleting={bulkDeleting}
                        deletingId={deletingId}
                        removingIds={removingIds}
                        allVisibleSelected={false}
                        onSelect={setSelected}
                        onToggleSelection={toggleInvoiceSelection}
                        onToggleSelectAllVisible={() => {}}
                        onToggleStatus={toggleStatus}
                        onApprove={handleAnimatedApprove}
                        onDelete={deleteInvoice}
                        showSelectAll={false}
                      />
                    </>
                  )}
                </div>
              </CollapsePanel>
            </section>
          );
        })}
      </div>

      {junkInvoices.length > 0 && (
        <Card padding="none" className="mt-6 overflow-hidden border-[#FCD34D]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 bg-[#FEF3C7] px-4 py-4 text-right transition hover:bg-[#FDE68A] md:px-5"
            onClick={() => setJunkDrawerExpanded((current) => !current)}
            aria-expanded={junkDrawerExpanded}
          >
            <div className="flex items-center gap-3">
              {junkDrawerExpanded ? <ChevronDown className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" /> : <ChevronLeft className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" />}
              <span className="text-lg font-black text-[#111827]">דורש בדיקה ידנית ({junkInvoices.length})</span>
            </div>
          </button>
          <CollapsePanel open={junkDrawerExpanded}>
            <div className="overflow-hidden border-t border-[#FDE68A] p-4 md:p-5">
              <InvoiceMobileList
                invoices={junkInvoices}
                selectedInvoiceIds={selectedInvoiceIds}
                bulkDeleting={bulkDeleting}
                deletingId={deletingId}
                removingIds={removingIds}
                onSelect={setSelected}
                onToggleSelection={toggleInvoiceSelection}
                onToggleStatus={toggleStatus}
                onApprove={handleAnimatedApprove}
                onDelete={deleteInvoice}
              />
              <InvoiceDesktopList
                invoices={junkInvoices}
                selectedInvoiceIds={selectedInvoiceIds}
                bulkDeleting={bulkDeleting}
                deletingId={deletingId}
                removingIds={removingIds}
                allVisibleSelected={false}
                onSelect={setSelected}
                onToggleSelection={toggleInvoiceSelection}
                onToggleSelectAllVisible={() => {}}
                onToggleStatus={toggleStatus}
                onApprove={handleAnimatedApprove}
                onDelete={deleteInvoice}
                showSelectAll={false}
              />
            </div>
          </CollapsePanel>
        </Card>
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
                    {selected.supplierName || selected.client?.name || MISSING_SUPPLIER}
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
              <DetailCard label="ספק" value={selected.supplierName || MISSING_SUPPLIER} />
              <DetailCard label="סכום" value={formatInvoiceAmount(selected)} highlight />
              <DetailCard label="מספר חשבונית" value={selected.invoiceNumber || MISSING_NUMBER} />
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
      </AppShell>
    </div>
  );
}

function CollapsePanel({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function invoiceRemovalClass(isRemoving: boolean) {
  return isRemoving
    ? "pointer-events-none max-h-0 overflow-hidden border-transparent opacity-0 !p-0 !py-0"
    : "max-h-[800px] opacity-100";
}

type InvoiceListProps = {
  invoices: Invoice[];
  selectedInvoiceIds: Set<string>;
  bulkDeleting: boolean;
  deletingId: string | null;
  removingIds: Set<string>;
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
  removingIds,
  onSelect,
  onToggleSelection,
  onToggleStatus,
  onApprove,
  onDelete,
}: InvoiceListProps) {
  return (
    <div className="grid gap-4 md:hidden">
      {invoices.map((invoice) => {
        const isRemoving = removingIds.has(invoice.id);
        return (
        <div
          key={invoice.id}
          className={`invoice-mobile-row space-y-2 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm transition-all duration-[250ms] ease-out ${invoiceRemovalClass(isRemoving)}`}
        >
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
                <div className="truncate text-base font-semibold text-[#111827]" title={invoice.client?.name ?? invoice.supplierName ?? MISSING_SUPPLIER}>{invoice.client?.name ?? invoice.supplierName ?? MISSING_SUPPLIER}</div>
              </button>
            </div>
            <ReviewStatusPill invoice={invoice} />
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
        );
      })}
    </div>
  );
}

function InvoiceDesktopList({
  invoices,
  selectedInvoiceIds,
  bulkDeleting,
  deletingId,
  removingIds,
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
            <th className="w-[4%] text-base font-bold text-[#111827]">
              {showSelectAll ? (
                <input type="checkbox" aria-label="בחר הכל בעמוד" checked={allVisibleSelected} onChange={onToggleSelectAllVisible} disabled={invoices.length === 0 || bulkDeleting} className="h-5 w-5 rounded border-[#9CA3AF]" />
              ) : null}
            </th>
            <th className="w-[20%] text-base font-bold text-[#111827]">לקוח/ספק</th>
            <th className="w-[10%] text-base font-bold text-[#111827]">תאריך</th>
            <th className="w-[30%] text-base font-bold text-[#111827]">תיאור</th>
            <th className="w-[10%] text-base font-bold text-[#111827]">סכום</th>
            <th className="w-[11%] text-base font-bold text-[#111827]">סטטוס</th>
            <th className="w-[15%] text-base font-bold text-[#111827]">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const isRemoving = removingIds.has(invoice.id);
            return (
            <tr
              key={invoice.id}
              onClick={() => onSelect(invoice)}
              className={`cursor-pointer border-b border-[#E5E7EB] bg-white transition-all duration-[250ms] ease-out hover:bg-[#F8FAFC] ${invoiceRemovalClass(isRemoving)}`}
            >
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
                    <div className="truncate text-base font-semibold" title={invoice.client?.name ?? invoice.supplierName ?? MISSING_SUPPLIER}>{invoice.client?.name ?? invoice.supplierName ?? MISSING_SUPPLIER}</div>
                    <div className="truncate text-xs font-normal text-[#9CA3AF]" title={invoiceMetaLine(invoice)}>{invoiceMetaLine(invoice)}</div>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap py-4 text-base font-normal text-[#6B7280]">{formatInvoiceDate(invoice.date)}</td>
              <td className="min-w-0 py-4 text-[#111827]">
                <div className="truncate text-base font-semibold" title={displayInvoiceDescription(invoice)}>{displayInvoiceDescription(invoice)}</div>
                <div className="truncate text-xs font-normal text-[#9CA3AF]" title={systemNoteForInvoice(invoice)}>{systemNoteForInvoice(invoice)}</div>
              </td>
              <td className="whitespace-nowrap py-4 text-base font-bold text-[#111827]">{formatInvoiceAmount(invoice)}</td>
              <td className="whitespace-nowrap py-4"><ReviewStatusPill invoice={invoice} /></td>
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
            );
          })}
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
  if (supplier && isLikelyJunkSupplierNameLocal(supplier)) return true;
  if (invoice.amount === 1_000_000) return true;
  const parsedDate = new Date(invoice.date);
  if (!Number.isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > new Date().getFullYear() + 1) return true;
  return false;
}

function formatInvoiceAmount(invoice: Invoice) {
  if (invoice.amountLabel) return invoice.amountLabel;
  if (invoice.amount == null || !Number.isFinite(invoice.amount)) return "סכום חסר";
  return formatCurrency(invoice.amount, invoice.currency);
}

function formatInvoiceDate(date: string | null | undefined) {
  if (!date) return MISSING_DATE;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return MISSING_DATE;
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

function formatCurrency(amount: number | null | undefined, currency: string) {
  return formatAmount(amount, currency, "סכום חסר");
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
    if (invoice.amount == null || !Number.isFinite(invoice.amount) || invoice.amount <= 0) return "לא זוהה סכום תקין";

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
  if (reviewStatus === "needs_review") return "border border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]";
  if (reviewStatus === "rejected") return "border border-[#FECACA] bg-[#FEE2E2] text-[#991B1B]";
  return "border border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]";
}

function statusBadgeDotColor(invoice: Invoice) {
  const reviewStatus = invoice.reviewStatus ?? "approved";
  if (reviewStatus === "needs_review") return "#D97706";
  if (reviewStatus === "rejected") return "#DC2626";
  return "#059669";
}

function ReviewStatusPill({ invoice }: { invoice: Invoice }) {
  const reviewStatus = invoice.reviewStatus ?? "approved";
  const tone = reviewStatus === "needs_review" ? "warn" : reviewStatus === "rejected" ? "danger" : "success";
  return <StatusBadge tone={tone}>{reviewBadgeLabel(invoice)}</StatusBadge>;
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
