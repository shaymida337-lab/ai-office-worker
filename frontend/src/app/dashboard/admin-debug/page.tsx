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
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [driveMerging, setDriveMerging] = useState(false);
  const [driveMergeStatus, setDriveMergeStatus] = useState("");
  const [driveMergePreview, setDriveMergePreview] = useState<DriveMergeDuplicateFoldersResponse | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [invoiceDebug, badAmountDebug, topPaymentDebug] = await Promise.all([
        apiFetch<InvoiceDebugResponse>("/api/debug/invoices"),
        apiFetch<BadInvoiceAmountsResponse>("/api/debug/invoices/bad-amounts"),
        apiFetch<TopPaymentAmountsResponse>("/api/debug/payments/top-amounts"),
      ]);
      setData(invoiceDebug);
      setBadAmounts(badAmountDebug);
      setTopPayments(topPaymentDebug);
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load debug data");
    } finally {
      setLoading(false);
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
      setError(err instanceof Error ? err.message : "Failed to clean bad amounts");
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
      throw new Error(`Drive merge job did not return a jobId. Start response: ${JSON.stringify(start)}`);
    }
    setDriveMergeStatus(start.progress || `Drive job started: ${jobId}`);

    const startedAt = Date.now();
    while (Date.now() - startedAt < DRIVE_JOB_MAX_WAIT_MS) {
      await wait(DRIVE_JOB_POLL_INTERVAL_MS);
      const status = await apiFetch<DriveMergeStatusResponse>(`/api/debug/drive/merge-status/${jobId}`, {
        timeoutMs: DRIVE_JOB_REQUEST_TIMEOUT_MS,
      });
      setDriveMergeStatus(status.progress || `Drive job status: ${status.status}`);

      if (status.status === "done" && status.result) {
        return status.result;
      }
      if (status.status === "error") {
        throw new Error(status.error || "Drive duplicate folder merge failed");
      }
    }

    throw new Error("Drive duplicate folder merge job timed out while polling status");
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
        setMessage("לא נמצאו תיקיות ספק כפולות ב-Drive.");
        setDriveMergeStatus("Dry-run complete");
        return;
      }

      const confirmed = window.confirm(
        `נמצאו ${preview.duplicateGroups} קבוצות כפולות, ${preview.foldersMerged} תיקיות לאיחוד ו-${preview.filesMoved} פריטים להעברה. להריץ איחוד אמיתי עכשיו?`
      );
      if (!confirmed) return;

      const result = await runDriveMergeJob(false);
      setDriveMergePreview(result);
      setMessage(`אוחדו ${result.foldersMerged} תיקיות כפולות והועברו ${result.filesMoved} פריטים.`);
      setDriveMergeStatus("Merge complete");
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to merge duplicate Drive folders");
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
        <div className="page-kicker">Production diagnostics</div>
        <h1>Admin Debug</h1>
        <p>נתוני production לפי המשתמש והארגון המחוברים.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button className="btn" onClick={load} disabled={loading || cleaning || driveMerging}>
          {loading ? "טוען..." : "רענן נתונים"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={cleanBadAmounts}
          disabled={loading || cleaning || driveMerging || (data?.badAmountCount ?? badAmounts?.badInvoiceCount ?? 0) === 0}
        >
          {cleaning ? "מנקה..." : "נקה סכומים שגויים"}
        </button>
        <button className="btn btn-secondary" onClick={mergeDuplicateDriveFolders} disabled={loading || cleaning || driveMerging}>
          {driveMerging ? "בודק Drive..." : "אחד תיקיות כפולות"}
        </button>
      </div>

      {error && <div className="toast border-red-400/30 text-red-200">{error}</div>}
      {message && <div className="toast border-emerald-400/30 text-emerald-200">{message}</div>}
      {driveMergeStatus && <div className="toast border-blue-400/30 text-blue-100">{driveMergeStatus}</div>}

      {data && (
        <>
          <section className="mb-6 grid gap-3 md:grid-cols-4">
            <Metric label="Invoice rows" value={data.invoiceCount ?? 0} />
            <Metric label="SupplierPayment rows" value={data.supplierPaymentCount ?? 0} />
            <Metric label="Gmail scan items" value={data.gmailScanItemCount ?? 0} />
            <Metric label="Invoice scan items" value={data.invoiceScanItemCount ?? 0} />
            <Metric label="Bad amount rows (> 10M)" value={data.badAmountCount ?? badAmounts?.badInvoiceCount ?? 0} />
            <Metric label="Money to pay counted rows" value={topPayments?.countedRows ?? 0} />
            <Metric label="Money to pay total" value={topPayments?.moneyToPay ?? 0} />
          </section>

          <section className="mb-6 grid gap-4">
            <div className="card">
              <h2>Authenticated User</h2>
              <p>User ID: {data.userId}</p>
              <p>Org ID: {data.orgId ?? data.organizationId ?? "unknown"}</p>
            </div>
          </section>

          <DebugTable title="Latest 20 Invoice rows" rows={data.lastInvoiceRows ?? []} />
          <DebugTable title="Bad amount invoice samples" rows={badAmounts?.sampleRows ?? []} />
          <DebugTable title="Top 10 SupplierPayment amounts counted in Money to Pay" rows={topPayments?.rows ?? []} />
          <DebugTable title="Drive duplicate folder merge preview" rows={driveMergePreview ? [driveMergePreview] : []} />
          <DebugTable title="Latest 20 SupplierPayment rows" rows={data.lastPaymentRows ?? []} />
          <DebugTable title="Rejected invoice reasons" rows={data.rejectedInvoiceReasons ?? []} />
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
