"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, getToken } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type AccountantSummary = {
  period: string;
  totalIncome: number;
  totalExpenses: number;
  profit: number;
  vatDue: number;
  invoiceCount: number;
  activeClientCount: number;
  vat: { dueDate: string; salesVAT: number; purchaseVAT: number; netVAT: number };
  reports: Array<{ id: string; period: string; driveUrl: string | null; createdAt: string }>;
  annual: Array<{ period: string; income: number; expenses: number }>;
};

export default function AccountantPage() {
  const [summary, setSummary] = useState<AccountantSummary | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setSummary(await apiFetch<AccountantSummary>("/api/accountant/summary"));
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת דוח רואה חשבון נכשלה"));
  }, []);

  const daysToVat = useMemo(() => {
    if (!summary) return 0;
    return Math.ceil((new Date(summary.vat.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }, [summary]);

  async function generate() {
    setLoading(true);
    setMessage("מייצר דוח...");
    try {
      await apiFetch("/api/accountant/generate", { method: "POST", body: JSON.stringify({ period: summary?.period }) });
      await load();
      setMessage("הדוח נוצר ונשמר ב-Drive");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "יצירת דוח נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function downloadZip() {
    const response = await fetch(`${API_URL}/api/accountant/download.zip?period=${encodeURIComponent(summary?.period ?? "")}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!response.ok) {
      setMessage("הורדת ZIP נכשלה");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `accountant-${summary?.period ?? "report"}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!summary) {
    return <div className="container"><Nav /><p>{message || "טוען..."}</p></div>;
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8"><div className="page-kicker">Accountant reports</div><h1>רואה חשבון</h1></div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">{message}</div>}
      <div className="grid">
        <div className="card"><div className="stat-label">הכנסות החודש</div><div className="stat-value">₪{summary.totalIncome.toLocaleString("he-IL")}</div></div>
        <div className="card"><div className="stat-label">הוצאות החודש</div><div className="stat-value">₪{summary.totalExpenses.toLocaleString("he-IL")}</div></div>
        <div className="card"><div className="stat-label">רווח</div><div className="stat-value">₪{summary.profit.toLocaleString("he-IL")}</div></div>
        <div className="card"><div className="stat-label">מע"מ לתשלום</div><div className="stat-value">₪{summary.vatDue.toLocaleString("he-IL")}</div></div>
      </div>
      <div className="card">
        <h2>תזכורת מע"מ</h2>
        <p>תאריך הגשה הבא: {new Date(summary.vat.dueDate).toLocaleDateString("he-IL")}</p>
        <p>ימים שנותרו: {daysToVat}</p>
        <p>סכום משוער: ₪{summary.vat.netVAT.toLocaleString("he-IL")}</p>
      </div>
      <div className="card">
        <h2>מסמכים מוכנים</h2>
        <div className="grid gap-3 sm:flex sm:flex-wrap">
          <button className="btn" onClick={generate} disabled={loading}>{loading ? "מייצר..." : "צור דוח חודש"}</button>
          <button className="btn btn-secondary" onClick={downloadZip}>הורד הכל כ-ZIP</button>
          <button className="btn btn-secondary" onClick={() => setMessage("שליחה באימייל תופעל אחרי הגדרת ספק מייל")}>שלח לרואה חשבון</button>
        </div>
        <ul className="mt-4 grid gap-2">
          {summary.reports.map((report) => (
            <li key={report.id} className="rounded-2xl bg-surface-secondary p-3">{report.period} {report.driveUrl ? <a className="text-accent-primary" href={report.driveUrl} target="_blank" rel="noreferrer">פתח PDF</a> : "ממתין ל-Drive"}</li>
          ))}
        </ul>
      </div>
      <div className="grid gap-4 md:hidden">
        <h2>סיכום שנתי</h2>
        {summary.annual.map((row) => (
          <div key={row.period} className="card">
            <h3 className="text-lg font-semibold text-ink-primary">{row.period}</h3>
            <div className="mt-3 grid gap-2 rounded-2xl bg-surface-secondary p-3">
              <div className="flex justify-between gap-3"><span className="text-ink-secondary">הכנסות</span><strong>₪{row.income.toLocaleString("he-IL")}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-ink-secondary">הוצאות</span><strong>₪{row.expenses.toLocaleString("he-IL")}</strong></div>
            </div>
          </div>
        ))}
      </div>
      <div className="table-shell hidden md:block">
        <h2>סיכום שנתי</h2>
        <table><thead><tr><th>חודש</th><th>הכנסות</th><th>הוצאות</th></tr></thead><tbody>
          {summary.annual.map((row) => <tr key={row.period}><td>{row.period}</td><td>₪{row.income.toLocaleString("he-IL")}</td><td>₪{row.expenses.toLocaleString("he-IL")}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
