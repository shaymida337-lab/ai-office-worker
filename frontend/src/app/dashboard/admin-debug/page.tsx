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
  organizationId: string;
  userId: string;
  backfillResult?: {
    candidates: number;
    paymentCandidates?: number;
    created: number;
    duplicates: number;
    skipped: number;
    errors: Array<{ gmailMessageId: string; reason: string }>;
  };
  invoiceCount: number;
  supplierPaymentCount: number;
  gmailScanItemCount: number;
  invoiceScanItemCount: number;
  invoiceCandidatePaymentCount?: number;
  lastInvoiceRows: DebugInvoiceRow[];
  lastPaymentRows: DebugPaymentRow[];
  invoiceOrReceiptScanItems: DebugScanItem[];
  rejectedInvoiceReasons: DebugScanItem[];
};

export default function AdminDebugPage() {
  const router = useRouter();
  const [data, setData] = useState<InvoiceDebugResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<InvoiceDebugResponse>("/api/debug/invoices"));
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

      <button className="btn mb-6" onClick={load} disabled={loading}>
        {loading ? "טוען..." : "רענן נתונים"}
      </button>

      {error && <div className="toast border-red-400/30 text-red-200">{error}</div>}

      {data && (
        <>
          <section className="mb-6 grid gap-3 md:grid-cols-4">
            <Metric label="Invoice rows" value={data.invoiceCount} />
            <Metric label="SupplierPayment rows" value={data.supplierPaymentCount} />
            <Metric label="Invoice scan items" value={data.invoiceScanItemCount} />
            <Metric label="Candidate payments" value={data.invoiceCandidatePaymentCount ?? 0} />
          </section>

          <section className="mb-6 grid gap-4 md:grid-cols-2">
            <div className="card">
              <h2>Authenticated User</h2>
              <p>User ID: {data.userId}</p>
              <p>Org ID: {data.organizationId}</p>
            </div>
            <div className="card">
              <h2>Backfill Result</h2>
              <pre className="overflow-auto text-xs text-ink-secondary">{JSON.stringify(data.backfillResult ?? {}, null, 2)}</pre>
            </div>
          </section>

          <DebugTable title="Latest 20 Invoice rows" rows={data.lastInvoiceRows} />
          <DebugTable title="Latest 20 SupplierPayment rows" rows={data.lastPaymentRows} />
          <DebugTable title="Invoice / Receipt scan items" rows={data.invoiceOrReceiptScanItems} />
          <DebugTable title="Rejected invoice reasons" rows={data.rejectedInvoiceReasons} />
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

function DebugTable({ title, rows }: { title: string; rows: unknown[] }) {
  return (
    <section className="card mb-6">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p>אין נתונים.</p>
      ) : (
        <pre className="mt-4 max-h-[520px] overflow-auto rounded-xl bg-surface-secondary p-4 text-xs text-ink-secondary">
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </section>
  );
}
