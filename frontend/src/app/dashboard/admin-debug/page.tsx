"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { apiFetch, isAuthError } from "@/lib/api";

type DebugInvoiceRow = {
  id: string;
  clientId?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  currency?: string | null;
  date?: string | null;
  status?: string | null;
  driveUrl?: string | null;
  gmailMessageId?: string | null;
  createdAt?: string | null;
  client?: { id: string; name: string; email?: string | null; domain?: string | null } | null;
};

type DebugPaymentRow = {
  id: string;
  supplier: string;
  amount: number;
  currency: string;
  date: string;
  emailSender?: string | null;
  invoiceLink: string | null;
  documentLink: string | null;
  subject: string | null;
  emailMessageId: string | null;
  createdAt: string;
};

type DebugScanItem = {
  id: string;
  gmailMessageId?: string;
  subject?: string;
  documentType?: string;
  reviewStatus?: string;
  decisionReason?: string;
  supplierName?: string;
  amount?: number | null;
  driveFileLink?: string | null;
  rawAnalysis?: unknown;
  createdAt?: string;
};

type InvoiceDebugResponse = {
  orgId?: string;
  organizationId?: string;
  userId: string;
  invoiceCount: number;
  supplierPaymentCount: number;
  gmailScanItemCount: number;
  invoiceScanItemCount: number;
  badAmountCount?: number;
  lastInvoiceRows?: DebugInvoiceRow[];
  lastPaymentRows?: DebugPaymentRow[];
  rejectedInvoiceReasons?: DebugScanItem[];
};

type BadInvoiceAmountsResponse = {
  orgId: string;
  threshold: number;
  badInvoiceCount: number;
  sampleRows: DebugInvoiceRow[];
};

type TopPaymentAmountsResponse = {
  orgId: string;
  countedRows: number;
  moneyToPay: number;
  rows: DebugPaymentRow[];
};

type PaymentClassificationInvestigationResponse = {
  orgId: string;
  countedRows: number;
  moneyToPay: number;
  cleanupPreviewSummary?: {
    totalRows: number;
    wouldMoveOutCount: number;
    currentMoneyToPay: number;
    newMoneyToPay: number;
    amountMovedOut: number;
  };
  domainSummary: Array<{
    domain: string;
    count: number;
    totalAmount: number;
  }>;
  rows: Array<{
    senderDomain: string;
    payment: DebugPaymentRow & {
      paid: boolean;
      paymentRequired: boolean;
      missingInvoice: boolean;
      dueDate?: string | null;
      source?: string | null;
      updatedAt?: string | null;
    };
    email: {
      id: string;
      gmailId: string;
      subject: string;
      fromAddress: string;
      snippet?: string | null;
      bodyTextPreview?: string | null;
      receivedAt: string;
      createdAt: string;
    } | null;
    scanItems: DebugScanItem[];
    cleanupPreview?: {
      sender: string | null;
      currentStoredAmount: number;
      newlyParsedAmount: number | null;
      wouldBeAmount: number | null;
      rule1FinancialSenderHold: boolean;
      rule2AutoSaveGateHold: boolean;
      rule3AmountSanityFlag: boolean;
      amountRejectedReason: string | null;
      wouldBeDocumentType: string;
      wouldBeReviewStatus: string;
      wouldBeDecisionReason: string;
      wouldMoveOutOfMoneyToPay: boolean;
      wouldRemainInMoneyToPay: boolean;
    };
  }>;
};

type FixBadAmountsResponse = {
  orgId: string;
  threshold: number;
  updatedCount: number;
};

type DriveMergeDuplicateFoldersResponse = {
  dryRun: boolean;
  rootFolderId: string;
  searchedRoots?: Array<{
    id: string;
    name: string;
    matchedCandidateName: string;
    directSupplierFolderCount: number;
    legacySupplierFolderCount: number;
    supplierFolderCount: number;
  }>;
  duplicateGroups: number;
  foldersMerged: number;
  filesMoved: number;
  groups: Array<{
    normalizedName: string;
    keep: { id: string; name: string; parentLabel: string; createdTime: string | null };
    duplicates: Array<{
      id: string;
      name: string;
      parentLabel: string;
      childCount: number;
      children: Array<{ id: string; name: string; mimeType: string | null }>;
    }>;
  }>;
};

type DriveMergeStartResponse = {
  jobId?: string;
  id?: string;
  dryRun: boolean;
  status: "running";
  progress: string;
};

type DriveMergeStatusResponse = {
  jobId?: string;
  id?: string;
  dryRun: boolean;
  status: "running" | "done" | "error";
  progress: string;
  result?: DriveMergeDuplicateFoldersResponse;
  error?: string;
};

const DRIVE_JOB_REQUEST_TIMEOUT_MS = 60_000;
const DRIVE_JOB_POLL_INTERVAL_MS = 2_500;
const DRIVE_JOB_MAX_WAIT_MS = 15 * 60_000;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function AdminDebugPage() {
  const router = useRouter();
  const [data, setData] = useState<InvoiceDebugResponse | null>(null);
  const [badAmounts, setBadAmounts] = useState<BadInvoiceAmountsResponse | null>(null);
  const [topPayments, setTopPayments] = useState<TopPaymentAmountsResponse | null>(null);
  const [paymentInvestigation, setPaymentInvestigation] = useState<PaymentClassificationInvestigationResponse | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [loadingTopPayments, setLoadingTopPayments] = useState(false);
  const [loadingPaymentInvestigation, setLoadingPaymentInvestigation] = useState(false);
  const [driveMerging, setDriveMerging] = useState(false);
  const [driveMergeStatus, setDriveMergeStatus] = useState("");
  const [driveMergePreview, setDriveMergePreview] = useState<DriveMergeDuplicateFoldersResponse | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [invoiceDebug, badAmountDebug] = await Promise.all([
        apiFetch<InvoiceDebugResponse>("/api/debug/invoices"),
        apiFetch<BadInvoiceAmountsResponse>("/api/debug/invoices/bad-amounts"),
      ]);
      setData(invoiceDebug);
      setBadAmounts(badAmountDebug);
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "טעינת נתוני האבחון נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function loadTopPayments() {
    setLoadingTopPayments(true);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<TopPaymentAmountsResponse>("/api/debug/payments/top-amounts");
      setTopPayments(result);
      setMessage(`נטענו ${result.rows.length} התשלומים הגדולים מתוך ${result.countedRows} שורות שמרכיבות את כסף לשלם.`);
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "טעינת התשלומים הגדולים נכשלה");
    } finally {
      setLoadingTopPayments(false);
    }
  }

  async function loadPaymentInvestigation() {
    setLoadingPaymentInvestigation(true);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<PaymentClassificationInvestigationResponse>("/api/debug/payments/classification-investigation", {
        method: "GET",
      });
      setPaymentInvestigation(result);
      setMessage(`נטענו ${result.rows.length} שורות תשלומי ספקים שמרכיבות את כסף לשלם.`);
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "טעינת בדיקת סיווג התשלומים נכשלה");
    } finally {
      setLoadingPaymentInvestigation(false);
    }
  }

  async function cleanBadAmounts() {
    const count = data?.badAmountCount ?? badAmounts?.badInvoiceCount ?? 0;
    const confirmed = window.confirm(`לנקות ${count} חשבוניות עם סכומים שגויים מעל 10,000,000? הפעולה תאפס את הסכום ל-0.`);
    if (!confirmed) return;

    setCleaning(true);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<FixBadAmountsResponse>("/api/debug/invoices/fix-bad-amounts", { method: "POST" });
      setMessage(`נוקו ${result.updatedCount} שורות עם סכומים שגויים.`);
      await load();
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "ניקוי סכומים שגויים נכשל");
    } finally {
      setCleaning(false);
    }
  }

  async function runDriveMergeJob(dryRun: boolean): Promise<DriveMergeDuplicateFoldersResponse> {
    const start = await apiFetch<DriveMergeStartResponse>("/api/debug/drive/merge-duplicate-folders", {
      method: "POST",
      body: JSON.stringify({ dryRun }),
      timeoutMs: DRIVE_JOB_REQUEST_TIMEOUT_MS,
    });
    const jobId = start.jobId ?? start.id;
    if (!jobId) {
      throw new Error(`משימת איחוד תיקיות דרייב לא החזירה מזהה. תגובת התחלה: ${JSON.stringify(start)}`);
    }
    setDriveMergeStatus(start.progress || `משימת דרייב התחילה: ${jobId}`);

    const startedAt = Date.now();
    while (Date.now() - startedAt < DRIVE_JOB_MAX_WAIT_MS) {
      await wait(DRIVE_JOB_POLL_INTERVAL_MS);
      const status = await apiFetch<DriveMergeStatusResponse>(`/api/debug/drive/merge-status/${jobId}`, {
        timeoutMs: DRIVE_JOB_REQUEST_TIMEOUT_MS,
      });
      setDriveMergeStatus(status.progress || `סטטוס משימת דרייב: ${status.status}`);

      if (status.status === "done" && status.result) {
        return status.result;
      }
      if (status.status === "error") {
        throw new Error(status.error || "איחוד תיקיות דרייב כפולות נכשל");
      }
    }

    throw new Error("משימת איחוד תיקיות דרייב כפולות הסתיימה בחריגת זמן");
  }

  async function mergeDuplicateDriveFolders() {
    setDriveMerging(true);
    setError("");
    setMessage("");
    setDriveMergeStatus("");
    try {
      const preview = await runDriveMergeJob(true);
      setDriveMergePreview(preview);

      if (preview.duplicateGroups === 0) {
        setMessage("לא נמצאו תיקיות ספק כפולות בדרייב.");
        setDriveMergeStatus("בדיקה מקדימה הושלמה");
        return;
      }

      const confirmed = window.confirm(
        `נמצאו ${preview.duplicateGroups} קבוצות כפולות, ${preview.foldersMerged} תיקיות לאיחוד ו-${preview.filesMoved} פריטים להעברה. להריץ איחוד אמיתי עכשיו?`
      );
      if (!confirmed) return;

      const result = await runDriveMergeJob(false);
      setDriveMergePreview(result);
      setMessage(`אוחדו ${result.foldersMerged} תיקיות כפולות והועברו ${result.filesMoved} פריטים.`);
      setDriveMergeStatus("האיחוד הושלם");
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "איחוד תיקיות דרייב כפולות נכשל");
    } finally {
      setDriveMerging(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="container">
      <Nav />
      <div className="mb-8">
        <div className="page-kicker">אבחון מערכת</div>
        <h1>בדיקות מנהל</h1>
        <p>נתוני סביבת הייצור לפי המשתמש והארגון המחוברים.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button className="btn" onClick={load} disabled={loading || cleaning || driveMerging || loadingTopPayments || loadingPaymentInvestigation}>
          {loading ? "טוען..." : "רענן נתונים"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={loadTopPayments}
          disabled={loading || cleaning || driveMerging || loadingTopPayments || loadingPaymentInvestigation}
        >
          {loadingTopPayments ? "טוען..." : "10 התשלומים הגדולים"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={loadPaymentInvestigation}
          disabled={loading || cleaning || driveMerging || loadingTopPayments || loadingPaymentInvestigation}
        >
          {loadingPaymentInvestigation ? "טוען..." : "בדוק סיווג תשלומים"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={cleanBadAmounts}
          disabled={loading || cleaning || driveMerging || loadingTopPayments || loadingPaymentInvestigation || (data?.badAmountCount ?? badAmounts?.badInvoiceCount ?? 0) === 0}
        >
          {cleaning ? "מנקה..." : "נקה סכומים שגויים"}
        </button>
        <button className="btn btn-secondary" onClick={mergeDuplicateDriveFolders} disabled={loading || cleaning || driveMerging || loadingTopPayments || loadingPaymentInvestigation}>
          {driveMerging ? "בודק דרייב..." : "אחד תיקיות כפולות"}
        </button>
      </div>

      {error && <div className="toast border-red-400/30 text-red-200">{error}</div>}
      {message && <div className="toast border-emerald-400/30 text-emerald-200">{message}</div>}
      {driveMergeStatus && <div className="toast border-blue-400/30 text-blue-100">{driveMergeStatus}</div>}

      <TopPaymentsTable data={topPayments} loading={loadingTopPayments} />
      <PaymentClassificationInvestigation data={paymentInvestigation} loading={loadingPaymentInvestigation} />

      {data && (
        <>
          <section className="mb-6 grid gap-3 md:grid-cols-4">
            <Metric label="רשומות חשבוניות" value={data.invoiceCount ?? 0} />
            <Metric label="רשומות תשלומי ספקים" value={data.supplierPaymentCount ?? 0} />
            <Metric label="פריטי סריקת ג׳ימייל" value={data.gmailScanItemCount ?? 0} />
            <Metric label="פריטי סריקת חשבוניות" value={data.invoiceScanItemCount ?? 0} />
            <Metric label="רשומות עם סכום חריג מעל 10 מיליון" value={data.badAmountCount ?? badAmounts?.badInvoiceCount ?? 0} />
            <Metric label="שורות שנכללו בכסף לשלם" value={topPayments?.countedRows ?? "לחץ לבדיקה"} />
            <Metric label="סה״כ כסף לשלם" value={topPayments ? `₪${topPayments.moneyToPay.toLocaleString("he-IL")}` : "לחץ לבדיקה"} />
          </section>

          <section className="mb-6 grid gap-4">
            <div className="card">
              <h2>משתמש מחובר</h2>
              <p>מזהה משתמש: {data.userId}</p>
              <p>מזהה ארגון: {data.orgId ?? data.organizationId ?? "לא ידוע"}</p>
            </div>
          </section>

          <DebugTable title="20 רשומות חשבוניות אחרונות" rows={data.lastInvoiceRows ?? []} />
          <DebugTable title="דוגמאות לחשבוניות עם סכום חריג" rows={badAmounts?.sampleRows ?? []} />
          <DebugTable title="תצוגה מקדימה לאיחוד תיקיות דרייב כפולות" rows={driveMergePreview ? [driveMergePreview] : []} />
          <DebugTable title="20 רשומות תשלומי ספקים אחרונות" rows={data.lastPaymentRows ?? []} />
          <DebugTable title="סיבות דחייה של חשבוניות" rows={data.rejectedInvoiceReasons ?? []} />
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function TopPaymentsTable({ data, loading }: { data: TopPaymentAmountsResponse | null; loading: boolean }) {
  const rows = data?.rows ?? [];

  return (
    <section className="mb-8 rounded-3xl border border-amber-400/30 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(15,23,42,0.96))] p-5 shadow-[0_20px_60px_rgba(245,158,11,0.12)]">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">בדיקת תשלומים לתשלום</div>
          <h2 className="text-2xl font-black text-[#F8FAFC]">10 התשלומים הגדולים</h2>
          <p className="mt-2 max-w-3xl text-base leading-7 text-[#E2E8F0]">
            שורות תשלומי ספקים שמרכיבות את "כסף לשלם": לא שולמו, נדרש תשלום, סכום בין 0 ל-1,000,000.
          </p>
        </div>
        {data && (
          <span className="rounded-2xl border border-amber-300/40 bg-amber-400/15 px-4 py-3 text-lg font-black text-amber-100">
            סה"כ מחושב: ₪{data.moneyToPay.toLocaleString("he-IL")}
          </span>
        )}
      </div>

      {loading ? (
        <p>טוען את התשלומים הגדולים...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4 text-base text-[#E2E8F0]">
          לחץ על "10 התשלומים הגדולים" כדי לטעון את הנתונים.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-amber-300/20 bg-surface-secondary/90">
          <table className="min-w-[900px] table-fixed">
            <thead>
              <tr className="border-b border-amber-300/20 bg-amber-400/10">
                <th className="w-48 px-4 py-4 text-right text-base font-black text-[#F8FAFC]">סכום</th>
                <th className="w-72 px-4 py-4 text-right text-base font-black text-[#F8FAFC]">ספק / שולח</th>
                <th className="w-52 px-4 py-4 text-right text-base font-black text-[#F8FAFC]">תאריך</th>
                <th className="px-4 py-4 text-left text-base font-black text-[#F8FAFC]">מזהה מייל</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="whitespace-nowrap px-4 py-5">
                    <div className="text-3xl font-black tracking-tight text-amber-200">
                      ₪{row.amount.toLocaleString("he-IL")}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[#CBD5E1]">{row.currency}</div>
                  </td>
                  <td className="break-words px-4 py-5">
                    <div className="text-lg font-bold text-[#F8FAFC]">{row.supplier || "ספק לא ידוע"}</div>
                    <div className="mt-1 text-base text-[#CBD5E1]">{row.emailSender || "שולח לא ידוע"}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-5 text-base font-semibold text-[#F1F5F9]">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString("he-IL") : "—"}
                  </td>
                  <td className="break-all px-4 py-5 text-left text-sm text-[#CBD5E1]" dir="ltr">
                    {row.emailMessageId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PaymentClassificationInvestigation({ data, loading }: { data: PaymentClassificationInvestigationResponse | null; loading: boolean }) {
  const rows = data?.rows ?? [];

  return (
    <section className="mb-8 rounded-3xl border border-red-400/30 bg-[linear-gradient(135deg,rgba(239,68,68,0.14),rgba(15,23,42,0.96))] p-5">
      <div className="mb-5">
        <div className="page-kicker">בדיקת סיווג</div>
        <h2 className="text-2xl font-black text-[#F8FAFC]">בדיקת סיווג כל התשלומים</h2>
        <p className="mt-2 text-base leading-7 text-[#E2E8F0]">
          בדיקה לקריאה בלבד לכל שורות תשלומי ספקים עם דרישת תשלום פתוחה, כולל מקור המייל והחלטת הסיווג.
        </p>
      </div>

      {loading ? (
        <p className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4 text-base">טוען פרטים...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4 text-base text-[#E2E8F0]">
          לחץ על "בדוק סיווג תשלומים" כדי לטעון את כל השורות שמרכיבות את כסף לשלם.
        </p>
      ) : (
        <div className="grid gap-5">
          <div className="rounded-2xl border border-red-300/20 bg-surface-secondary/95 p-4">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-xl font-black text-[#F8FAFC]">סיכום לפי דומיין שולח</h3>
                <p className="text-base text-[#CBD5E1]">
                  {data?.countedRows ?? 0} שורות · סה"כ ₪{(data?.moneyToPay ?? 0).toLocaleString("he-IL")}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-red-300/20">
              <table className="min-w-[620px] table-fixed">
                <thead>
                  <tr className="border-b border-red-300/20 bg-red-400/10">
                    <th className="w-72 px-4 py-3 text-right text-base font-black text-[#F8FAFC]">דומיין</th>
                    <th className="w-32 px-4 py-3 text-right text-base font-black text-[#F8FAFC]">כמות</th>
                    <th className="px-4 py-3 text-right text-base font-black text-[#F8FAFC]">סה"כ ₪</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.domainSummary ?? []).map((domain) => (
                    <tr key={domain.domain} className="border-b border-[var(--border)] last:border-0">
                      <td className="break-all px-4 py-3 text-left text-base font-semibold text-[#F8FAFC]" dir="ltr">{domain.domain}</td>
                      <td className="px-4 py-3 text-base text-[#E2E8F0]">{domain.count}</td>
                      <td className="px-4 py-3 text-lg font-black text-red-100">₪{domain.totalAmount.toLocaleString("he-IL")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data?.cleanupPreviewSummary && (
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
              <h3 className="text-xl font-black text-[#F8FAFC]">תצוגה מקדימה לניקוי לפי המנוע החדש</h3>
              <p className="mt-2 text-base text-[#D1FAE5]">
                {data.cleanupPreviewSummary.wouldMoveOutCount} מתוך {data.cleanupPreviewSummary.totalRows} שורות היו יוצאות מ-"כסף לשלם".
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Metric label="כסף לשלם נוכחי" value={`₪${data.cleanupPreviewSummary.currentMoneyToPay.toLocaleString("he-IL")}`} />
                <Metric label="סכום שיוסר" value={`₪${data.cleanupPreviewSummary.amountMovedOut.toLocaleString("he-IL")}`} />
                <Metric label="כסף לשלם חדש" value={`₪${data.cleanupPreviewSummary.newMoneyToPay.toLocaleString("he-IL")}`} />
              </div>
            </div>
          )}

          {rows.map((row) => {
            const primaryScan = row.scanItems[0];
            return (
              <article key={row.payment.id} className="rounded-2xl border border-red-300/20 bg-surface-secondary/95 p-4">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-3xl font-black text-red-200">₪{row.payment.amount.toLocaleString("he-IL")} {row.payment.currency}</div>
                    <div className="mt-1 text-lg font-bold text-[#F8FAFC]">{row.payment.supplier}</div>
                    <div className="text-base text-[#CBD5E1]">{row.payment.emailSender ?? row.email?.fromAddress ?? "שולח לא ידוע"}</div>
                    <div className="mt-1 break-all text-sm font-semibold text-red-100" dir="ltr">{row.senderDomain}</div>
                  </div>
                  <div className="grid gap-1 text-base text-[#E2E8F0] md:text-left">
                    <span>נוצר: {new Date(row.payment.createdAt).toLocaleString("he-IL")}</span>
                    <span>שולם: {row.payment.paid ? "כן" : "לא"} · נדרש תשלום: {row.payment.paymentRequired ? "כן" : "לא"}</span>
                    <span dir="ltr" className="break-all text-sm text-[#CBD5E1]">{row.payment.emailMessageId ?? "—"}</span>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-surface-hover/70 p-4">
                    <h3 className="mb-2 text-lg font-bold text-[#F8FAFC]">פרטי המייל</h3>
                    <p className="text-base text-[#E2E8F0]">נושא: {row.email?.subject ?? row.payment.subject ?? "—"}</p>
                    <p className="mt-2 text-base text-[#CBD5E1]">תקציר: {row.email?.snippet ?? "—"}</p>
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-secondary p-3 text-sm text-[#CBD5E1]">
                      {row.email?.bodyTextPreview ?? "אין bodyText שמור"}
                    </pre>
                  </div>

                  <div className="rounded-2xl bg-surface-hover/70 p-4">
                    <h3 className="mb-2 text-lg font-bold text-[#F8FAFC]">סיווג וניתוח גולמי</h3>
                    <p className="text-base text-[#E2E8F0]">סוג מסמך: {primaryScan?.documentType ?? "—"}</p>
                    <p className="text-base text-[#E2E8F0]">סטטוס בדיקה: {primaryScan?.reviewStatus ?? "—"}</p>
                    <p className="text-base text-[#E2E8F0]">סיבת החלטה: {primaryScan?.decisionReason ?? "—"}</p>
                    {row.cleanupPreview && (
                      <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-[#D1FAE5]">
                        <div className="font-bold text-[#F8FAFC]">החלטת ניקוי צפויה</div>
                        <p>סכום חדש שזוהה: {row.cleanupPreview.newlyParsedAmount === null ? "אין" : `₪${row.cleanupPreview.newlyParsedAmount.toLocaleString("he-IL")}`}</p>
                        <p>סכום לאחר ניקוי: {row.cleanupPreview.wouldBeAmount === null ? "אין" : `₪${row.cleanupPreview.wouldBeAmount.toLocaleString("he-IL")}`}</p>
                        <p>כלל 1 - השהיית בנק: {row.cleanupPreview.rule1FinancialSenderHold ? "כן" : "לא"}</p>
                        <p>כלל 2 - השהיית שמירה אוטומטית: {row.cleanupPreview.rule2AutoSaveGateHold ? "כן" : "לא"}</p>
                        <p>כלל 3 - בדיקת סבירות סכום: {row.cleanupPreview.rule3AmountSanityFlag ? "כן" : "לא"}</p>
                        <p>סיבת סכום: {row.cleanupPreview.amountRejectedReason ?? "—"}</p>
                        <p>סטטוס צפוי: {row.cleanupPreview.wouldBeReviewStatus}</p>
                        <p>סיבת החלטה: {row.cleanupPreview.wouldBeDecisionReason}</p>
                      </div>
                    )}
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-secondary p-3 text-xs text-[#CBD5E1]">
                      {primaryScan ? JSON.stringify(primaryScan.rawAnalysis ?? primaryScan, null, 2) : "לא נמצא פריט סריקת ג׳ימייל קשור"}
                    </pre>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DebugTable({ title, rows }: { title: string; rows?: unknown[] }) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return (
    <section className="card mb-6">
      <h2>{title}</h2>
      {safeRows?.length === 0 ? (
        <p>אין נתונים.</p>
      ) : (
        <pre className="mt-4 max-h-[520px] overflow-auto rounded-xl bg-surface-secondary p-4 text-xs text-ink-secondary">
          {JSON.stringify(safeRows, null, 2)}
        </pre>
      )}
    </section>
  );
}
