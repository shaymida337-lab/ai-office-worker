"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { BarChart3, FileCheck2, HardDrive, MailCheck, Table2 } from "lucide-react";

type ScanStatsResponse = {
  totals: {
    scanItems: number;
    emailsProcessed: number;
    emailsSaved: number;
    duplicatesSkipped: number;
    driveLinked: number;
    amountExtracted: number;
    sheetsUpdated: number;
  };
  byDocumentType: Record<string, number>;
  byReviewStatus: Record<string, number>;
  recentItems: ScanItem[];
  recentLogs: ScanLog[];
};

type ScanItem = {
  id: string;
  gmailMessageLink: string;
  sender: string;
  senderEmail: string | null;
  subject: string;
  occurredAt: string;
  amount: number | null;
  supplierName: string;
  documentType: string;
  attachmentFilename: string | null;
  driveFileLink: string | null;
  confidenceScore: string;
  reviewStatus: string;
  decisionReason: string;
};

type ScanLog = {
  id: string;
  status: string;
  scanMode: string | null;
  emailsProcessed: number;
  emailsSaved: number;
  invoicesFound: number;
  paymentsCreated: number;
  tasksCreated: number;
  driveUploaded: number;
  sheetsUpdated: number;
  errorsCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const documentTypeLabels: Record<string, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  payment_request: "Payment Request",
  supplier_message: "Supplier Document",
  unknown_needs_review: "Other",
};

const reviewStatusLabels: Record<string, string> = {
  auto_saved: "נשמר אוטומטית",
  needs_review: "דורש בדיקה",
  failed: "נכשל",
  rejected: "נדחה",
};

export default function ScanStatsPage() {
  const [data, setData] = useState<ScanStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<ScanStatsResponse>("/api/gmail/scan-stats"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "טעינת סטטיסטיקות הסריקה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const typeRows = useMemo(() => Object.entries(data?.byDocumentType ?? {}), [data]);
  const reviewRows = useMemo(() => Object.entries(data?.byReviewStatus ?? {}), [data]);

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">איכות סריקת ג׳ימייל</div>
          <h1>סטטיסטיקות סריקה</h1>
          <p>מעקב אחרי זיהוי חשבוניות, קבלות, דרישות תשלום, מסמכי ספקים ופריטים לבדיקה.</p>
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? "מרענן..." : "רענן נתונים"}</button>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="card"><p>טוען סטטיסטיקות סריקה...</p></div>
      ) : data ? (
        <>
          <section className="auto-grid mb-6">
            <Kpi label="מיילים שנבדקו" value={data.totals.emailsProcessed} icon={<MailCheck className="h-5 w-5" />} />
            <Kpi label="פריטים שנשמרו" value={data.totals.scanItems} icon={<FileCheck2 className="h-5 w-5" />} />
            <Kpi label="כפילויות שסוננו" value={data.totals.duplicatesSkipped} icon={<BarChart3 className="h-5 w-5" />} />
            <Kpi label="קבצים בדרייב" value={data.totals.driveLinked} icon={<HardDrive className="h-5 w-5" />} />
            <Kpi label="עדכוני שיטס" value={data.totals.sheetsUpdated} icon={<Table2 className="h-5 w-5" />} />
          </section>

          <section className="mb-6 grid gap-6 lg:grid-cols-2">
            <Breakdown title="לפי סוג מסמך" rows={typeRows} labels={documentTypeLabels} />
            <Breakdown title="לפי סטטוס בדיקה" rows={reviewRows} labels={reviewStatusLabels} />
          </section>

          <section className="card">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2>פריטים אחרונים מהסריקה</h2>
                <p className="text-sm">כולל נושא אמיתי, ספק, סכום, סוג מסמך, ביטחון וקישור נקי לג׳ימייל.</p>
              </div>
            </div>

            {data.recentItems.length === 0 ? (
              <p>אין עדיין פריטי סריקה להצגה.</p>
            ) : (
              <>
                <div className="grid gap-4 md:hidden">
                  {data.recentItems.map((item) => <ScanItemCard key={item.id} item={item} />)}
                </div>
                <div className="table-shell hidden md:block">
                  <table>
                    <thead>
                      <tr>
                        <th>תאריך</th>
                        <th>ספק</th>
                        <th>נושא</th>
                        <th>סוג</th>
                        <th>סכום</th>
                        <th>ביטחון</th>
                        <th>סטטוס</th>
                        <th>קישורים</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentItems.map((item) => (
                        <tr key={item.id}>
                          <td>{new Date(item.occurredAt).toLocaleDateString("he-IL")}</td>
                          <td>{item.supplierName || item.senderEmail || "לא זוהה"}</td>
                          <td className="max-w-sm">{item.subject || "ללא נושא"}</td>
                          <td>{documentTypeLabel(item.documentType)}</td>
                          <td>{formatAmount(item.amount)}</td>
                          <td>{confidenceLabel(item.confidenceScore)}</td>
                          <td>{reviewStatusLabels[item.reviewStatus] ?? item.reviewStatus}</td>
                          <td>
                            <div className="flex flex-wrap gap-2">
                              <a className="btn btn-secondary px-3 py-1.5" href={item.gmailMessageLink} target="_blank" rel="noreferrer">פתח בג׳ימייל</a>
                              {item.driveFileLink && <a className="btn btn-secondary px-3 py-1.5" href={item.driveFileLink} target="_blank" rel="noreferrer">פתח בדרייב</a>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="mt-6 card">
            <h2>ריצות סריקה אחרונות</h2>
            <div className="mt-4 grid gap-3">
              {data.recentLogs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{scanStatusLabel(log.status)}</strong>
                    <span className="badge badge-ok">{new Date(log.startedAt).toLocaleString("he-IL")}</span>
                  </div>
                  <p className="mt-2 text-sm">
                    מיילים {log.emailsProcessed} · נשמרו {log.emailsSaved} · חשבוניות {log.invoicesFound} · תשלומים {log.paymentsCreated} · דרייב {log.driveUploaded} · שיטס {log.sheetsUpdated}
                  </p>
                  {log.errorMessage && <p className="mt-2 text-sm text-red-200">{log.errorMessage}</p>}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function ScanItemCard({ item }: { item: ScanItem }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate">{item.supplierName || item.senderEmail || "ספק לא זוהה"}</h2>
          <p className="break-words text-sm">{item.subject || "ללא נושא"}</p>
        </div>
        <span className="badge badge-warn">{documentTypeLabel(item.documentType)}</span>
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <MobileRow label="סכום" value={formatAmount(item.amount)} />
        <MobileRow label="ביטחון" value={confidenceLabel(item.confidenceScore)} />
        <MobileRow label="סטטוס" value={reviewStatusLabels[item.reviewStatus] ?? item.reviewStatus} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a className="btn btn-secondary" href={item.gmailMessageLink} target="_blank" rel="noreferrer">פתח בג׳ימייל</a>
        {item.driveFileLink && <a className="btn btn-secondary" href={item.driveFileLink} target="_blank" rel="noreferrer">פתח בדרייב</a>}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value.toLocaleString("he-IL")}</div>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-hover text-accent-primary">{icon}</span>
      </div>
    </div>
  );
}

function Breakdown({ title, rows, labels }: { title: string; rows: Array<[string, number]>; labels: Record<string, string> }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="mt-4 grid gap-3">
        {rows.length === 0 ? <p>אין נתונים עדיין.</p> : rows.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-xl bg-surface-secondary p-3">
            <span>{labels[key] ?? key}</span>
            <strong>{value.toLocaleString("he-IL")}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <strong className="text-ink-primary">{value}</strong>
    </div>
  );
}

function documentTypeLabel(type: string) {
  return documentTypeLabels[type] ?? "Other";
}

function confidenceLabel(value: string) {
  if (value === "high") return "גבוה";
  if (value === "medium") return "בינוני";
  return "נמוך";
}

function scanStatusLabel(status: string) {
  if (status === "success") return "הושלמה";
  if (status === "running") return "רצה עכשיו";
  if (status === "error") return "שגיאה";
  return status;
}

function formatAmount(amount: number | null) {
  return amount == null ? "לא זוהה" : `₪${amount.toLocaleString("he-IL")}`;
}
