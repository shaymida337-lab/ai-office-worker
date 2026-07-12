"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react";
import { Nav } from "@/components/Nav";
import { formatAmountValue } from "@/lib/format/amount";
import { apiFetch } from "@/lib/api";

type UploadSummary = {
  matched: number;
  suggested: number;
  unmatched: number;
};

type BankUploadResponse = {
  statementId: string;
  transactionCount: number;
  summary: UploadSummary;
  warnings?: string[];
};

type BankStatementListItem = {
  id: string;
  fileName: string;
  uploadedAt: string;
  status: string;
  transactionCount: number;
};

type MatchedInvoice = {
  id: string;
  invoiceNumber: string | null;
  amount: number;
  date: string;
  status: string;
  client?: { name: string } | null;
};

type MatchedSupplierPayment = {
  id: string;
  supplier: string;
  amount: number;
  date: string;
  paid: boolean;
  subject: string | null;
};

type BankTransaction = {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  direction: "credit" | "debit" | string;
  matchStatus: "matched" | "suggested" | "unmatched" | string;
  matchedInvoiceId: string | null;
  matchedSupplierPaymentId: string | null;
  matchConfidence: number | null;
  matchedRecord: null | { type: "invoice"; record: MatchedInvoice | null } | { type: "supplierPayment"; record: MatchedSupplierPayment | null };
};

type BankStatementDetail = {
  statement: BankStatementListItem;
  transactions: BankTransaction[];
};

const statusLabels: Record<string, string> = {
  processing: "מעבד",
  ready: "מוכן",
  error: "שגיאה",
};

export default function BankReconciliationPage() {
  const [statements, setStatements] = useState<BankStatementListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BankStatementDetail | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingStatements, setLoadingStatements] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [lastUpload, setLastUpload] = useState<BankUploadResponse | null>(null);

  async function loadStatements() {
    const data = await apiFetch<{ statements: BankStatementListItem[] }>("/api/bank/statements");
    setStatements(data.statements ?? []);
  }

  async function loadDetail(statementId: string) {
    setLoadingDetail(true);
    setSelectedId(statementId);
    try {
      const data = await apiFetch<BankStatementDetail>(`/api/bank/statements/${statementId}`);
      setDetail(data);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "טעינת דף הבנק נכשלה");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    loadStatements()
      .catch((err) => {
        setMessageTone("error");
        setMessage(err instanceof Error ? err.message : "טעינת דפי בנק נכשלה");
      })
      .finally(() => setLoadingStatements(false));
  }, []);

  async function uploadStatement() {
    if (!file) {
      setMessageTone("error");
      setMessage("בחר קובץ גיליון או קובץ תנועות לפני העלאה.");
      return;
    }

    setUploading(true);
    setMessageTone("info");
    setMessage("מעלה ומעבד את דף התנועות...");
    setLastUpload(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiFetch<BankUploadResponse>("/api/bank/upload", {
        method: "POST",
        body: formData,
        timeoutMs: 60_000,
      });
      setLastUpload(result);
      setMessageTone("success");
      setMessage("דף התנועות עובד בהצלחה.");
      setFile(null);
      await loadStatements();
      await loadDetail(result.statementId);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "העלאת דף הבנק נכשלה");
    } finally {
      setUploading(false);
    }
  }

  async function confirmTransaction(transactionId: string) {
    setActingId(transactionId);
    setMessage("");
    try {
      await apiFetch(`/api/bank/transactions/${transactionId}/confirm`, { method: "POST" });
      if (selectedId) await loadDetail(selectedId);
      setMessageTone("success");
      setMessage("ההתאמה אושרה.");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "אישור ההתאמה נכשל");
    } finally {
      setActingId(null);
    }
  }

  async function rejectTransaction(transactionId: string) {
    setActingId(transactionId);
    setMessage("");
    try {
      await apiFetch(`/api/bank/transactions/${transactionId}/reject`, { method: "POST" });
      if (selectedId) await loadDetail(selectedId);
      setMessageTone("success");
      setMessage("ההצעה נדחתה.");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "דחיית ההתאמה נכשלה");
    } finally {
      setActingId(null);
    }
  }

  const currentSummary = useMemo(() => {
    const transactions = detail?.transactions ?? [];
    return {
      matched: transactions.filter((transaction) => transaction.matchStatus === "matched").length,
      suggested: transactions.filter((transaction) => transaction.matchStatus === "suggested").length,
      unmatched: transactions.filter((transaction) => transaction.matchStatus === "unmatched").length,
    };
  }, [detail]);

  const messageClasses = {
    info: "border-accent-primary/40 bg-accent-primary/15 text-[#E0E7FF]",
    success: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
    error: "border-red-400/40 bg-red-500/15 text-red-100",
  }[messageTone];

  return (
    <div className="container text-base text-[#F1F5F9]">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">התאמת בנק</div>
          <h1>התאמת בנק</h1>
          <p className="text-[17px] leading-8 text-[#E2E8F0]">העלאת דפי בנק, זיהוי תנועות והתאמה לחשבוניות ותשלומי ספקים.</p>
        </div>
      </div>

      {message && <div className={`mb-6 rounded-2xl border p-4 text-base font-medium leading-7 ${messageClasses}`}>{message}</div>}

      <section className="mb-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="card">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] text-white">
              <UploadCloud className="h-6 w-6" />
            </span>
            <div>
              <h2>העלה דף תנועות מהבנק</h2>
              <p className="text-base text-[#E2E8F0]">קבצי גיליון או קובץ תנועות. המערכת תזהה תנועות ותציע התאמות בלבד.</p>
            </div>
          </div>

          <label className="mb-4 grid cursor-pointer place-items-center rounded-3xl border border-dashed border-accent-primary/40 bg-accent-primary/10 p-8 text-center transition hover:bg-accent-primary/15">
            <FileSpreadsheet className="mb-3 h-10 w-10 text-accent-primary" />
            <span className="text-lg font-bold text-[#F8FAFC]">{file ? file.name : "בחר קובץ תנועות"}</span>
            <span className="mt-2 text-base text-[#CBD5E1]">קובץ גיליון או תנועות בנק</span>
            <input
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <button className="btn min-h-[54px]" onClick={uploadStatement} disabled={uploading || !file}>
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
            {uploading ? "מעבד..." : "העלה ועבד"}
          </button>

          {lastUpload && (
            <div className="mt-5 grid gap-3 rounded-2xl bg-surface-secondary p-4 sm:grid-cols-3">
              <Metric label="הותאמו" value={lastUpload.summary.matched} tone="text-emerald-300" />
              <Metric label="הצעות" value={lastUpload.summary.suggested} tone="text-amber-300" />
              <Metric label="לא הותאמו" value={lastUpload.summary.unmatched} tone="text-red-300" />
            </div>
          )}
        </div>

        <div className="card">
          <h2>דפי בנק שהועלו</h2>
          <p className="mb-4 text-base text-[#E2E8F0]">בחר דף כדי לראות תנועות והתאמות.</p>
          {loadingStatements ? (
            <p>טוען דפי בנק...</p>
          ) : statements.length === 0 ? (
            <p>עדיין לא הועלו דפי בנק.</p>
          ) : (
            <div className="grid gap-3">
              {statements.map((statement) => (
                <button
                  key={statement.id}
                  type="button"
                  onClick={() => loadDetail(statement.id)}
                  className={[
                    "rounded-2xl border p-4 text-right transition hover:bg-surface-hover",
                    selectedId === statement.id ? "border-accent-primary/50 bg-accent-primary/15" : "border-[var(--border)] bg-surface-secondary",
                  ].join(" ")}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <strong className="break-words text-[#F8FAFC]">{statement.fileName}</strong>
                    <span className={`badge ${statement.status === "ready" ? "badge-ok" : statement.status === "error" ? "badge-error" : "badge-warn"}`}>
                      {statusLabels[statement.status] ?? statement.status}
                    </span>
                  </div>
                  <p className="text-base text-[#CBD5E1]">
                    {new Date(statement.uploadedAt).toLocaleString("he-IL")} · {statement.transactionCount} תנועות
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {detail && (
        <section className="card">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2>{detail.statement.fileName}</h2>
              <p className="text-base text-[#E2E8F0]">
                {new Date(detail.statement.uploadedAt).toLocaleString("he-IL")} · {detail.statement.transactionCount} תנועות
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="מאושר" value={currentSummary.matched} tone="text-emerald-300" />
              <Metric label="הצעות" value={currentSummary.suggested} tone="text-amber-300" />
              <Metric label="לא מותאם" value={currentSummary.unmatched} tone="text-red-300" />
            </div>
          </div>

          {loadingDetail ? (
            <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />טוען תנועות...</p>
          ) : (
            <>
              <div className="grid gap-4 md:hidden">
                {detail.transactions.map((transaction) => (
                  <TransactionCard
                    key={transaction.id}
                    transaction={transaction}
                    acting={actingId === transaction.id}
                    onConfirm={() => confirmTransaction(transaction.id)}
                    onReject={() => rejectTransaction(transaction.id)}
                  />
                ))}
              </div>

              <div className="table-shell hidden max-w-full overflow-x-auto md:block">
                <table className="min-w-[1120px] table-fixed">
                  <thead>
                    <tr>
                      <th className="w-28 text-base font-bold text-[#F8FAFC]">תאריך</th>
                      <th className="w-32 text-base font-bold text-[#F8FAFC]">סכום</th>
                      <th className="w-24 text-base font-bold text-[#F8FAFC]">כיוון</th>
                      <th className="text-base font-bold text-[#F8FAFC]">תיאור</th>
                      <th className="w-56 text-base font-bold text-[#F8FAFC]">סטטוס והתאמה</th>
                      <th className="w-52 text-base font-bold text-[#F8FAFC]">פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td className="whitespace-nowrap text-base text-[#F1F5F9]">{new Date(transaction.date).toLocaleDateString("he-IL")}</td>
                        <td className="whitespace-nowrap text-base font-bold text-[#F8FAFC]">₪{formatAmountValue(transaction.amount)}</td>
                        <td><DirectionBadge direction={transaction.direction} /></td>
                        <td className="max-w-0 truncate text-base text-[#E2E8F0]">{transaction.description ?? "—"}</td>
                        <td><MatchSummary transaction={transaction} /></td>
                        <td><MatchActions transaction={transaction} acting={actingId === transaction.id} onConfirm={() => confirmTransaction(transaction.id)} onReject={() => rejectTransaction(transaction.id)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="rounded-2xl bg-surface-hover/60 p-3 text-center">
      <div className="text-sm font-semibold text-[#CBD5E1]">{label}</div>
      <div className={`mt-1 text-2xl font-black ${tone}`}>{value}</div>
    </div>
  );
}

function TransactionCard({ transaction, acting, onConfirm, onReject }: { transaction: BankTransaction; acting: boolean; onConfirm: () => void; onReject: () => void }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <strong className="text-lg text-[#F8FAFC]">₪{formatAmountValue(transaction.amount)}</strong>
          <p className="text-base text-[#CBD5E1]">{new Date(transaction.date).toLocaleDateString("he-IL")}</p>
        </div>
        <DirectionBadge direction={transaction.direction} />
      </div>
      <p className="mb-3 break-words text-base leading-7 text-[#E2E8F0]">{transaction.description ?? "ללא תיאור"}</p>
      <MatchSummary transaction={transaction} />
      <div className="mt-4">
        <MatchActions transaction={transaction} acting={acting} onConfirm={onConfirm} onReject={onReject} />
      </div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  const isCredit = direction === "credit";
  return <span className={`badge ${isCredit ? "badge-ok" : "badge-warn"}`}>{isCredit ? "זכות" : "חובה"}</span>;
}

function MatchSummary({ transaction }: { transaction: BankTransaction }) {
  const tone = matchTone(transaction);
  const Icon = transaction.matchStatus === "matched" ? CheckCircle2 : transaction.matchStatus === "suggested" ? AlertTriangle : XCircle;
  return (
    <div className={`rounded-2xl border p-3 text-base leading-7 ${tone.box}`}>
      <div className="mb-1 flex items-center gap-2 font-bold">
        <Icon className="h-4 w-4" />
        {matchStatusLabel(transaction)}
      </div>
      {transaction.matchedRecord && <div className="text-[#F8FAFC]">{matchedRecordLabel(transaction)}</div>}
      {transaction.matchStatus === "suggested" && (
        <div className="text-sm text-[#FDE68A]">
          {suggestionReason(transaction)}
        </div>
      )}
    </div>
  );
}

function MatchActions({ transaction, acting, onConfirm, onReject }: { transaction: BankTransaction; acting: boolean; onConfirm: () => void; onReject: () => void }) {
  if (transaction.matchStatus === "matched") {
    return <span className="inline-flex items-center gap-2 text-base font-bold text-emerald-200"><CheckCircle2 className="h-4 w-4" />מאושר</span>;
  }
  if (transaction.matchStatus !== "suggested") return <span className="text-base text-[#CBD5E1]">אין הצעה לאישור</span>;
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      <button className="btn px-3 py-2 text-sm" onClick={onConfirm} disabled={acting}>{acting ? "מעדכן..." : "אשר"}</button>
      <button className="btn btn-secondary px-3 py-2 text-sm" onClick={onReject} disabled={acting}>דחה</button>
    </div>
  );
}

function matchTone(transaction: BankTransaction) {
  if (transaction.matchStatus === "matched" || (transaction.matchStatus === "suggested" && (transaction.matchConfidence ?? 0) >= 0.9)) {
    return { box: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" };
  }
  if (transaction.matchStatus === "suggested") {
    return { box: "border-amber-400/40 bg-amber-500/15 text-amber-100" };
  }
  return { box: "border-red-400/40 bg-red-500/15 text-red-100" };
}

function matchStatusLabel(transaction: BankTransaction) {
  if (transaction.matchStatus === "matched") return "מותאם";
  if (transaction.matchStatus === "suggested" && (transaction.matchConfidence ?? 0) >= 0.9) return "הצעה חזקה";
  if (transaction.matchStatus === "suggested") return "הצעה לא ודאית";
  return "לא מותאם";
}

function matchedRecordLabel(transaction: BankTransaction) {
  if (!transaction.matchedRecord?.record) return "הרשומה המוצעת לא נמצאה";
  if (transaction.matchedRecord.type === "invoice") {
    const invoice = transaction.matchedRecord.record;
    return `חשבונית ${invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : invoice.client?.name ?? invoice.id} · ₪${formatAmountValue(invoice.amount)}`;
  }
  const payment = transaction.matchedRecord.record;
  return `${payment.supplier} · ₪${formatAmountValue(payment.amount)}`;
}

function suggestionReason(transaction: BankTransaction) {
  const confidence = transaction.matchConfidence ?? 0;
  if (confidence >= 0.9) return `סכום ותאריך תואמים · ביטחון ${Math.round(confidence * 100)}%`;
  return `התאמה לא ודאית · ביטחון ${Math.round(confidence * 100)}%`;
}
