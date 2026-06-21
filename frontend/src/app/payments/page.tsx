"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, Loader2 } from "lucide-react";
import { Nav } from "@/components/Nav";
import { StatusPill } from "@/components/ui/StatusPill";
import { apiFetch, type Payment } from "@/lib/api";
import { isJunkPayment } from "@/lib/junkSupplier";
import { labelFor } from "@/lib/labels";

type MonthSummary = {
  year: number;
  month: number;
  count: number;
  totalsByCurrency: Record<string, number>;
};

type PaymentMonthsResponse = { months: MonthSummary[] };

const REMOVAL_ANIMATION_MS = 250;

export default function PaymentsPage() {
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());
  const [paymentsByMonth, setPaymentsByMonth] = useState<Record<string, Payment[]>>({});
  const [loadingMonth, setLoadingMonth] = useState<Set<string>>(() => new Set());
  const [monthsLoading, setMonthsLoading] = useState(true);
  const [junkDrawerExpanded, setJunkDrawerExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const skipDuplicatesRefresh = useRef(true);

  function duplicatesQueryConnector() {
    return duplicatesOnly ? "&duplicatesOnly=true" : "";
  }

  async function loadMonthPayments(monthKey: string) {
    setLoadingMonth((current) => new Set(current).add(monthKey));
    try {
      const data = await apiFetch<Payment[]>(`/api/payments?month=${monthKey}${duplicatesQueryConnector()}`);
      setPaymentsByMonth((current) => ({ ...current, [monthKey]: data }));
    } finally {
      setLoadingMonth((current) => {
        const next = new Set(current);
        next.delete(monthKey);
        return next;
      });
    }
  }

  async function loadMonthsPayments(monthKeys: string[]) {
    if (monthKeys.length === 0) {
      setPaymentsByMonth({});
      return;
    }
    setLoadingMonth(new Set(monthKeys));
    try {
      const results = await Promise.all(
        monthKeys.map(async (monthKey) => {
          const data = await apiFetch<Payment[]>(`/api/payments?month=${monthKey}${duplicatesQueryConnector()}`);
          return [monthKey, data] as const;
        })
      );
      setPaymentsByMonth(Object.fromEntries(results));
    } finally {
      setLoadingMonth(new Set());
    }
  }

  async function refreshMonthsAndPayments(monthKeysToLoad?: string[]) {
    const monthsData = await apiFetch<PaymentMonthsResponse>("/api/payments/months");
    setMonths(monthsData.months);
    const allKeys = monthsData.months.map((month) => monthKey(month.year, month.month));
    const keysToLoad = monthKeysToLoad ?? allKeys;
    setExpandedMonths((current) => {
      const next = new Set(current);
      for (const key of allKeys) next.add(key);
      return next;
    });
    await loadMonthsPayments(keysToLoad);
  }

  async function load() {
    setMonthsLoading(true);
    try {
      await refreshMonthsAndPayments();
    } finally {
      setMonthsLoading(false);
    }
  }

  useEffect(() => {
    load().catch((err) => {
      setMessage(err instanceof Error ? err.message : "טעינת תשלומי ספקים נכשלה");
    });
  }, []);

  useEffect(() => {
    if (monthsLoading) return;
    if (skipDuplicatesRefresh.current) {
      skipDuplicatesRefresh.current = false;
      return;
    }
    const loadedKeys = Object.keys(paymentsByMonth);
    refreshMonthsAndPayments(loadedKeys.length > 0 ? loadedKeys : undefined).catch((err) => {
      setMessage(err instanceof Error ? err.message : "רענון תשלומי ספקים נכשל");
    });
  }, [duplicatesOnly, monthsLoading]);

  const allLoadedPayments = useMemo(
    () => Object.values(paymentsByMonth).flat(),
    [paymentsByMonth]
  );

  const junkPayments = useMemo(() => {
    const junk: Payment[] = [];
    const seen = new Set<string>();
    for (const payment of allLoadedPayments) {
      if (!isJunkPayment(payment) || seen.has(payment.id)) continue;
      seen.add(payment.id);
      junk.push(payment);
    }
    return junk;
  }, [allLoadedPayments]);

  const monthPaymentsForDisplay = (monthKeyValue: string) => {
    const payments = paymentsByMonth[monthKeyValue] ?? [];
    return payments.filter((payment) => !isJunkPayment(payment));
  };

  function toggleMonthExpanded(monthKeyValue: string) {
    setExpandedMonths((current) => {
      const next = new Set(current);
      if (next.has(monthKeyValue)) {
        next.delete(monthKeyValue);
      } else {
        next.add(monthKeyValue);
        if (!paymentsByMonth[monthKeyValue]) {
          void loadMonthPayments(monthKeyValue).catch((err) => {
            setMessage(err instanceof Error ? err.message : "טעינת תשלומי החודש נכשלה");
          });
        }
      }
      return next;
    });
  }

  async function markPaid(id: string) {
    setUpdatingId(id);
    setMessage("");
    try {
      await apiFetch(`/api/payments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ paid: true }),
      });
      const loadedKeys = Object.keys(paymentsByMonth);
      await refreshMonthsAndPayments(loadedKeys.length > 0 ? loadedKeys : undefined);
      setMessage("התשלום סומן כשולם");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון התשלום נכשל");
    } finally {
      setUpdatingId(null);
    }
  }

  async function deletePayment(payment: Payment) {
    const confirmed = window.confirm(
      `למחוק את תשלום הספק "${payment.supplier}" בסכום ₪${payment.amount.toLocaleString("he-IL")}? הפעולה תמחק את הרשומה מה-DB.`
    );
    if (!confirmed) return;
    setDeletingId(payment.id);
    setMessage("");
    setRemovingIds((current) => new Set(current).add(payment.id));
    try {
      await new Promise((resolve) => window.setTimeout(resolve, REMOVAL_ANIMATION_MS));
      const result = await apiFetch<{
        deleted?: { supplierPayments?: number; documentReviews?: number };
        verification?: { beforeCount?: number; afterCount?: number };
        unlinked?: { bankTransactions?: number; tasks?: number };
      }>(`/api/payments/${payment.id}/delete`, { method: "POST" });
      if ((result.deleted?.supplierPayments ?? 0) < 1 || (result.verification?.afterCount ?? 1) !== 0) {
        throw new Error(
          `השרת לא מחק את הרשומה. נמחקו ${result.deleted?.supplierPayments ?? 0}, נשארו ${result.verification?.afterCount ?? "לא ידוע"}.`
        );
      }
      const loadedKeys = Object.keys(paymentsByMonth);
      await refreshMonthsAndPayments(loadedKeys.length > 0 ? loadedKeys : undefined);
      setMessage(`נמחקו ${result.deleted?.supplierPayments ?? 1} תשלומי ספקים. נותקו ${result.unlinked?.bankTransactions ?? 0} התאמות בנק.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "מחיקת התשלום נכשלה");
    } finally {
      setDeletingId(null);
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(payment.id);
        return next;
      });
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">ספקים ותשלומים</div>
        <h1>תשלומי ספקים</h1>
        <p className="mt-2 text-base font-semibold leading-7 text-[#111827]">
          מעקב אחרי תשלומים שזוהו מהמיילים, כולל מסמכים חסרים וסטטוס תשלום.
        </p>
      </div>
      <div className="mb-6 grid gap-3 sm:flex sm:flex-wrap">
        <button
          className={`min-h-[44px] rounded-2xl px-4 py-3 text-base font-black ${duplicatesOnly ? "btn" : "btn btn-secondary"}`}
          onClick={() => setDuplicatesOnly((value) => !value)}
          type="button"
        >
          {duplicatesOnly ? "מציג כפילויות בלבד" : "הצג כפילויות בלבד"}
        </button>
      </div>
      {message && (
        <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">
          {message}
        </div>
      )}

      {monthsLoading && (
        <div className="mb-5 flex items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white p-8 text-[#111827] shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-base font-bold">טוען חודשים...</span>
        </div>
      )}

      {!monthsLoading && months.length === 0 && junkPayments.length === 0 && (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 text-center text-[#111827] shadow-sm">
          <h2 className="text-[#111827]">עדיין אין תשלומי ספקים</h2>
          <p className="mt-2 text-base font-bold text-[#4B5563]">
            הפעל סריקת ג׳ימייל מלוח הבקרה כדי לזהות דרישות תשלום, חשבוניות ומסמכים מספקים.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {months.map((month) => {
          const key = monthKey(month.year, month.month);
          const isExpanded = expandedMonths.has(key);
          const monthPayments = monthPaymentsForDisplay(key);
          const totals = formatMonthTotalsSummary(month.totalsByCurrency);
          const isLoading = loadingMonth.has(key);

          return (
            <section key={key} className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
              <button
                type="button"
                className="sticky top-0 z-10 flex w-full items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white/85 px-4 py-4 text-right backdrop-blur-sm transition hover:bg-white/95 md:px-5"
                onClick={() => toggleMonthExpanded(key)}
                aria-expanded={isExpanded}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" />
                  ) : (
                    <ChevronLeft className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" />
                  )}
                  <div className="min-w-0">
                    <div className="text-lg font-black text-[#111827]">{formatMonthTitle(month.year, month.month)}</div>
                    <div className="mt-1 text-sm font-medium text-[#6B7280]">
                      {month.count} תשלומים
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
                  {isLoading && monthPayments.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm font-bold text-[#4B5563]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      טוען תשלומים...
                    </div>
                  ) : monthPayments.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[#9CA3AF]">אין תשלומים להצגה בחודש זה</p>
                  ) : (
                    <PaymentRows
                      payments={monthPayments}
                      updatingId={updatingId}
                      deletingId={deletingId}
                      removingIds={removingIds}
                      onMarkPaid={markPaid}
                      onDelete={deletePayment}
                      onPreview={setPreviewUrl}
                    />
                  )}
                </div>
              </CollapsePanel>
            </section>
          );
        })}
      </div>

      {junkPayments.length > 0 && (
        <section className="mt-6 rounded-2xl border border-[#D97706] bg-white shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 bg-[#FEF3C7] px-4 py-4 text-right transition hover:bg-[#FDE68A] md:px-5"
            onClick={() => setJunkDrawerExpanded((current) => !current)}
            aria-expanded={junkDrawerExpanded}
          >
            <div className="flex items-center gap-3">
              {junkDrawerExpanded ? (
                <ChevronDown className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" />
              ) : (
                <ChevronLeft className="h-5 w-5 shrink-0 transition-transform duration-300 ease-out" />
              )}
              <span className="text-lg font-black text-[#111827]">דורש בדיקה ידנית ({junkPayments.length})</span>
            </div>
          </button>
          <CollapsePanel open={junkDrawerExpanded}>
            <div className="overflow-hidden border-t border-[#FDE68A] p-4 md:p-5">
              <PaymentRows
                payments={junkPayments}
                updatingId={updatingId}
                deletingId={deletingId}
                removingIds={removingIds}
                onMarkPaid={markPaid}
                onDelete={deletePayment}
                onPreview={setPreviewUrl}
              />
            </div>
          </CollapsePanel>
        </section>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[120] overflow-y-auto bg-black/70 p-0 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="h-screen w-full overflow-hidden bg-white p-4 text-[#111827] sm:h-[85vh] sm:max-w-5xl sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2>תצוגה מקדימה לחשבונית</h2>
              <div className="grid gap-2 sm:flex">
                <a
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#1D4ED8] bg-white px-4 py-3 text-sm font-bold text-[#111827]"
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  פתח בדרייב
                </a>
                <button
                  className="min-h-[44px] rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm font-bold text-[#111827]"
                  type="button"
                  onClick={() => setPreviewUrl(null)}
                >
                  סגור
                </button>
              </div>
            </div>
            <iframe
              className="h-[calc(100vh-9rem)] w-full rounded-2xl border border-[var(--border-subtle)] bg-white sm:h-[calc(85vh-8rem)]"
              src={toDrivePreviewUrl(previewUrl)}
              title="Invoice preview"
            />
          </div>
        </div>
      )}
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

type PaymentRowsProps = {
  payments: Payment[];
  updatingId: string | null;
  deletingId: string | null;
  removingIds: Set<string>;
  onMarkPaid: (id: string) => void;
  onDelete: (payment: Payment) => void;
  onPreview: (url: string) => void;
};

function PaymentRows({ payments, updatingId, deletingId, removingIds, onMarkPaid, onDelete, onPreview }: PaymentRowsProps) {
  return (
    <>
      <div className="grid gap-4 md:hidden">
        {payments.map((p) => {
          const isRemoving = removingIds.has(p.id);
          return (
            <div
              key={p.id}
              className={`overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm transition-all duration-[250ms] ease-out ${paymentRemovalClass(isRemoving)}`}
              dir="rtl"
            >
              <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="min-w-0 break-words text-xl font-black leading-7 text-[#111827] [overflow-wrap:anywhere]">
                    {p.supplier || "לא ידוע"}
                  </h2>
                  <p className="mt-1 min-w-0 break-words text-sm font-semibold leading-6 text-[#6B7280] [overflow-wrap:anywhere]">
                    {paymentSenderMeta(p)}
                  </p>
                </div>
                <StatusPill tone={p.paid ? "success" : "warn"}>{paymentStatusLabel(p.paid ? "paid" : "pending")}</StatusPill>
              </div>
              <p className="mb-3 min-w-0 break-words text-sm font-semibold leading-6 text-[#6B7280] [overflow-wrap:anywhere]">
                {formatPaymentDate(p.date)}
                {p.dueDate ? ` · לתשלום עד ${formatPaymentDate(p.dueDate)}` : ""}
              </p>
              {paymentDescription(p) !== "—" && (
                <p className="mb-3 min-w-0 break-words text-base font-semibold leading-6 text-[#111827] [overflow-wrap:anywhere]">
                  {paymentDescription(p)}
                </p>
              )}
              <div className="mb-3 text-lg font-black text-[#111827]">{formatPaymentAmount(p)}</div>
              <div className="mb-3 flex flex-wrap gap-2">
                <StatusPill tone={p.paid ? "success" : "warn"}>{paymentStatusLabel(p.paid ? "paid" : "pending")}</StatusPill>
                {p.missingInvoice && <StatusPill tone="warn">{paymentStatusLabel("missing_invoice")}</StatusPill>}
                {p.duplicateDetected && <StatusPill tone="warn">{duplicateStatusLabel(p.duplicateReason)}</StatusPill>}
              </div>
              <div className="grid min-w-0 gap-2 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <MobileRow label="מסמך" value={documentSummary(p)} />
                {p.duplicateDetected && <MobileRow label="כפילות" value={duplicateStatusLabel(p.duplicateReason)} />}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {p.documentLink && (
                  <button
                    className="min-h-[44px] min-w-0 rounded-xl border border-[#1D4ED8] bg-[#DBEAFE] px-3 py-2 text-center text-sm font-bold text-[#111827] shadow-sm transition hover:bg-[#BFDBFE]"
                    type="button"
                    onClick={() => onPreview(p.documentLink!)}
                  >
                    <span className="truncate">תצוגת מסמך</span>
                  </button>
                )}
                {p.invoiceLink && (
                  <button
                    className="min-h-[44px] min-w-0 rounded-xl border border-[#1D4ED8] bg-[#DBEAFE] px-3 py-2 text-center text-sm font-bold text-[#111827] shadow-sm transition hover:bg-[#BFDBFE]"
                    type="button"
                    onClick={() => onPreview(p.invoiceLink!)}
                  >
                    <span className="truncate">תצוגת חשבונית</span>
                  </button>
                )}
                <button
                  className="min-h-[44px] min-w-0 rounded-xl border border-red-600 bg-red-600 px-3 py-2 text-center text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
                  type="button"
                  onClick={() => onDelete(p)}
                  disabled={deletingId === p.id}
                >
                  {deletingId === p.id ? "מוחק..." : "מחק תשלום"}
                </button>
                {!p.paid && (
                  <button
                    className="min-h-[44px] min-w-0 rounded-xl border border-[#1D4ED8] bg-[#1D4ED8] px-3 py-2 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#1746c7] disabled:opacity-60"
                    onClick={() => onMarkPaid(p.id)}
                    disabled={updatingId === p.id}
                  >
                    {updatingId === p.id ? "מעדכן..." : "סמן כשולם"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="table-shell hidden max-w-full overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm md:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-right text-[#111827]" dir="rtl">
          <thead className="bg-[#F3F4F6]">
            <tr className="border-b border-[#E5E7EB]">
              <th className="w-[4%] px-1 py-3 align-middle text-sm font-black text-[#111827]">מחק</th>
              <th className="w-[20%] px-3 py-3 align-middle text-sm font-black text-[#111827]">ספק</th>
              <th className="w-[12%] px-3 py-3 align-middle text-sm font-black text-[#111827]">סכום</th>
              <th className="w-[12%] px-3 py-3 align-middle text-sm font-black text-[#111827]">תאריך</th>
              <th className="w-[22%] px-3 py-3 align-middle text-sm font-black text-[#111827]">סטטוס</th>
              <th className="w-[15%] px-3 py-3 align-middle text-sm font-black text-[#111827]">מסמך</th>
              <th className="w-[15%] px-3 py-3 align-middle text-sm font-black text-[#111827]">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const isRemoving = removingIds.has(p.id);
              return (
                <tr
                  key={p.id}
                  className={`border-b border-[#E5E7EB] bg-white transition-all duration-[250ms] ease-out hover:bg-[#F8FAFC] ${paymentRemovalClass(isRemoving)}`}
                >
                  <td className="px-1 py-4 align-middle text-[#111827]">
                    <button
                      className="min-h-[32px] w-full truncate rounded-lg bg-red-600 px-1 py-1 text-xs font-bold text-white shadow-sm disabled:opacity-60"
                      onClick={() => onDelete(p)}
                      disabled={deletingId === p.id}
                      title="מחק תשלום"
                    >
                      {deletingId === p.id ? "מוחק..." : "מחק"}
                    </button>
                  </td>
                  <td className="min-w-0 px-3 py-4 align-middle text-[#111827]">
                    <div className="flex max-w-full items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E5E7EB] bg-[#F3F4F6] text-sm font-black text-[#111827]">
                        {(p.supplier || "ספק").slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-[#111827]" title={p.supplier || "לא ידוע"}>
                          {p.supplier || "לא ידוע"}
                        </div>
                        <div className="truncate text-xs font-normal text-[#9CA3AF]" title={paymentSenderMeta(p)}>
                          {paymentSenderMeta(p)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 align-middle text-base font-bold text-[#111827]">
                    {formatPaymentAmount(p)}
                  </td>
                  <td className="px-3 py-4 align-middle text-[#111827]">
                    <div className="whitespace-nowrap text-base font-semibold">{formatPaymentDate(p.date)}</div>
                    {p.dueDate && (
                      <div
                        className="truncate text-xs font-normal text-[#9CA3AF]"
                        title={`לתשלום עד ${formatPaymentDate(p.dueDate)}`}
                      >
                        לתשלום עד {formatPaymentDate(p.dueDate)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-4 align-middle">
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      <StatusPill tone={p.paid ? "success" : "warn"}>{paymentStatusLabel(p.paid ? "paid" : "pending")}</StatusPill>
                      {p.missingInvoice && <StatusPill tone="warn">{paymentStatusLabel("missing_invoice")}</StatusPill>}
                      {p.duplicateDetected && <StatusPill tone="warn">{duplicateStatusLabel(p.duplicateReason)}</StatusPill>}
                    </div>
                  </td>
                  <td className="px-3 py-4 align-middle font-semibold text-[#111827]">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {p.documentLink && (
                        <button
                          className="rounded-lg border border-[#1D4ED8] bg-[#DBEAFE] px-2 py-1 text-xs font-bold text-[#111827] transition hover:bg-[#BFDBFE]"
                          type="button"
                          onClick={() => onPreview(p.documentLink!)}
                        >
                          מסמך
                        </button>
                      )}
                      {p.invoiceLink && (
                        <button
                          className="rounded-lg border border-[#1D4ED8] bg-[#DBEAFE] px-2 py-1 text-xs font-bold text-[#111827] transition hover:bg-[#BFDBFE]"
                          type="button"
                          onClick={() => onPreview(p.invoiceLink!)}
                        >
                          חשבונית
                        </button>
                      )}
                      {!p.documentLink && !p.invoiceLink && <span className="text-sm font-semibold text-[#6B7280]">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-4 align-middle">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {!p.paid && (
                        <button
                          className="rounded-lg border border-[#1D4ED8] bg-white px-2 py-1 text-xs font-bold text-[#111827] shadow-sm transition hover:bg-[#EFF6FF] disabled:opacity-60"
                          onClick={() => onMarkPaid(p.id)}
                          disabled={updatingId === p.id}
                        >
                          {updatingId === p.id ? "מעדכן..." : "סמן כשולם"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function paymentRemovalClass(isRemoving: boolean) {
  return isRemoving
    ? "pointer-events-none max-h-0 overflow-hidden border-transparent opacity-0 !p-0 !py-0"
    : "max-h-[800px] opacity-100";
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

function formatCurrency(amount: number, currency: string) {
  const symbol = currency === "ILS" || !currency ? "₪" : currency;
  return `${symbol}${amount.toLocaleString("he-IL")}`;
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm leading-6 text-[#111827]">
      <span className="shrink-0 font-black text-[#111827]">{label}:</span>
      <span className="min-w-0 flex-1 break-words text-left font-semibold text-[#111827] [overflow-wrap:anywhere]">
        {value || "—"}
      </span>
    </div>
  );
}

function formatPaymentDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("he-IL");
}

function formatPaymentAmount(payment: Payment) {
  const symbol = payment.currency === "ILS" || !payment.currency ? "₪" : payment.currency;
  return `${symbol}${payment.amount.toLocaleString("he-IL")}`;
}

function paymentDescription(payment: Payment) {
  return payment.subject?.trim() || "—";
}

function paymentSenderMeta(payment: Payment) {
  const sender = payment.emailSender?.trim() || "שולח לא ידוע";
  const sources = (payment.sources ?? []).filter(Boolean).join(", ");
  return sources ? `${sender} · מקורות: ${sources}` : sender;
}

function documentSummary(payment: Payment) {
  if (payment.documentLink && payment.invoiceLink) return "מסמך + חשבונית";
  if (payment.invoiceLink) return "חשבונית";
  if (payment.documentLink) return "מסמך";
  return "—";
}

function paymentStatusLabel(status: string) {
  return labelFor("paymentStatus", status);
}

function duplicateStatusLabel(reason: string | null | undefined) {
  const label = labelFor("duplicateReason", reason);
  return label === "זוהתה" ? "כפילות" : `כפילות - ${label}`;
}

function toDrivePreviewUrl(url: string) {
  return url.replace(/\/view(?:\?.*)?$/, "/preview");
}
