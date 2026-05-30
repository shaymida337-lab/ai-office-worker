"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, FileSearch, Mail, Paperclip, ReceiptText } from "lucide-react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type DiagnosticsResponse = {
  latestScan: {
    id: string;
    status: string;
    emailsProcessed: number;
    invoicesFound: number;
    paymentsCreated: number;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  } | null;
  totals: {
    scannedEmails: number;
    scanItems: number;
    emailsWithAttachments: number;
    emailsWithPdfAttachments: number;
    emailsWithInvoiceKeywords: number;
    emailsWithTaxInvoiceKeywords: number;
    emailsWithReceiptKeywords: number;
    emailsWithPaymentRequestKeywords: number;
    candidateInvoicesBeforeFiltering: number;
    approvedInvoices: number;
    rejectedInvoices: number;
    supplierPaymentsCreated: number;
  };
  rejectionCounts: Record<string, number>;
  rejectedCandidates: Array<{
    sender: string;
    senderEmail: string | null;
    subject: string;
    rejectionReason: string;
    confidenceScore: string;
    documentType: string;
    reviewStatus: string;
  }>;
};

export default function InvoiceDiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<DiagnosticsResponse>("/api/gmail/invoice-diagnostics", { timeoutMs: 30000 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "טעינת אבחון חשבוניות נכשלה");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rejectionRows = useMemo(
    () => Object.entries(data?.rejectionCounts ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 20),
    [data]
  );

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">דיאגנוסטיקה זמנית</div>
          <h1>אבחון חשבוניות</h1>
          <p>דוח קריאה בלבד שמסביר למה סריקת Gmail דחתה מועמדים לחשבוניות.</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? "מרענן..." : "רענן דוח"}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="card"><p>טוען דוח אבחון...</p></div>
      ) : data ? (
        <>
          <section className="card mb-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2>סריקה אחרונה</h2>
                <p className="text-sm text-ink-secondary">
                  {data.latestScan
                    ? `סטטוס: ${data.latestScan.status} · התחילה: ${new Date(data.latestScan.startedAt).toLocaleString("he-IL")}`
                    : "לא נמצאה סריקת Gmail."}
                </p>
              </div>
              {data.latestScan?.errorMessage && (
                <span className="rounded-full bg-red-500/15 px-3 py-1 text-sm text-red-100">{data.latestScan.errorMessage}</span>
              )}
            </div>
          </section>

          <section className="auto-grid mb-6">
            <Kpi label="מיילים שנסרקו" value={data.totals.scannedEmails} icon={<Mail className="h-5 w-5" />} />
            <Kpi label="עם קבצים מצורפים" value={data.totals.emailsWithAttachments} icon={<Paperclip className="h-5 w-5" />} />
            <Kpi label="עם PDF" value={data.totals.emailsWithPdfAttachments} icon={<FileSearch className="h-5 w-5" />} />
            <Kpi label="מועמדי חשבונית" value={data.totals.candidateInvoicesBeforeFiltering} icon={<ReceiptText className="h-5 w-5" />} />
            <Kpi label="חשבוניות שאושרו" value={data.totals.approvedInvoices} icon={<ReceiptText className="h-5 w-5" />} />
            <Kpi label="חשבוניות שנדחו" value={data.totals.rejectedInvoices} icon={<AlertTriangle className="h-5 w-5" />} />
          </section>

          <section className="mb-6 grid gap-6 lg:grid-cols-2">
            <div className="card">
              <h2>סימני חשבונית</h2>
              <Metric label="Invoice keywords" value={data.totals.emailsWithInvoiceKeywords} />
              <Metric label="Tax invoice keywords" value={data.totals.emailsWithTaxInvoiceKeywords} />
              <Metric label="Receipt keywords" value={data.totals.emailsWithReceiptKeywords} />
              <Metric label="Payment request keywords" value={data.totals.emailsWithPaymentRequestKeywords} />
              <Metric label="Supplier payments created" value={data.totals.supplierPaymentsCreated} />
            </div>
            <div className="card">
              <h2>סיבות דחייה מובילות</h2>
              {rejectionRows.length === 0 ? (
                <p className="mt-3 text-sm text-ink-secondary">אין דחיות להצגה.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {rejectionRows.map(([reason, count]) => (
                    <div key={reason} className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-3">
                      <div className="mb-1 text-sm font-semibold text-ink-primary">{count} מיילים</div>
                      <div className="text-sm text-ink-secondary">{reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <h2>50 מועמדים שנדחו</h2>
            <p className="mt-1 text-sm text-ink-secondary">שולח, נושא, סיבת דחייה ו-confidence score.</p>
            {data.rejectedCandidates.length === 0 ? (
              <p className="mt-4 text-sm text-ink-secondary">אין מועמדים דחויים להצגה.</p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
                {data.rejectedCandidates.map((item, index) => (
                  <div key={`${item.subject}-${index}`} className="border-b border-[var(--border-subtle)] bg-surface-secondary p-4 last:border-b-0">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink-primary">{item.subject || "ללא נושא"}</div>
                        <div className="mt-1 text-sm text-ink-secondary">{item.senderEmail || item.sender}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-400/15 px-3 py-1 text-sm font-semibold text-amber-100">
                        {item.confidenceScore}
                      </span>
                    </div>
                    <div className="mt-3 rounded-xl bg-surface-card p-3 text-sm text-ink-secondary">{item.rejectionReason}</div>
                    <div className="mt-2 text-xs text-ink-muted">{item.documentType} · {item.reviewStatus}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="card">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-primary/15 text-accent-primary">{icon}</div>
      <div className="text-3xl font-bold text-ink-primary">{value.toLocaleString("he-IL")}</div>
      <div className="mt-1 text-sm text-ink-secondary">{label}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-3 flex items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary px-4 py-3">
      <span className="text-sm text-ink-secondary">{label}</span>
      <strong className="text-ink-primary">{value.toLocaleString("he-IL")}</strong>
    </div>
  );
}
