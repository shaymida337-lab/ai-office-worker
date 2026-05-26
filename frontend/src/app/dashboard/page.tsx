"use client";

import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import {
  apiFetch,
  clearToken,
  isAuthError,
  type DashboardStats,
  type GmailStatus,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import { Activity, ArrowUpRight, Clock3, FileText, HeartPulse, MessageCircle, Plus, RefreshCcw, ScanLine, WalletCards } from "lucide-react";

type ClientSummary = {
  id: string;
  name: string;
  color: string | null;
  stats?: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

type ClientsResponse = {
  clients: ClientSummary[];
  totals: {
    toPay: number;
    openTasks: number;
    invoices: number;
    missingInvoices: number;
  };
};

type ScanStatus = {
  logs: Array<{
    id: string;
    type: string;
    status: string;
    found: number;
    saved: number;
    errors: string | null;
    startedAt: string;
    endedAt: string | null;
  }>;
  last: {
    id: string;
    type: string;
    status: string;
    found: number;
    saved: number;
    errors: string | null;
    startedAt: string;
    endedAt: string | null;
  } | null;
  nextScheduledScanAt: string;
};

type WhatsAppAssistantStats = {
  sentToday: number;
  activeChats: number;
};

type ScanToast = {
  type: "info" | "success" | "error";
  text: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [clients, setClients] = useState<ClientsResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [whatsAppStats, setWhatsAppStats] = useState<WhatsAppAssistantStats | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [firstScanRunning, setFirstScanRunning] = useState(false);
  const [firstScanSummary, setFirstScanSummary] = useState("");
  const [scanProgress, setScanProgress] = useState<string[]>([]);
  const [scanToast, setScanToast] = useState<ScanToast | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await apiFetch<DashboardStats>("/api/dashboard");
      setStats(s);
      const sum = await apiFetch<{ text: string }>("/api/summary/daily");
      setSummary(sum.text);
      const gmail = await apiFetch<GmailStatus>("/api/integrations/gmail/status");
      setGmailStatus(gmail);
      const clientData = await apiFetch<ClientsResponse>("/api/clients");
      setClients(clientData);
      const automation = await apiFetch<ScanStatus>("/api/automation/scan-status");
      setScanStatus(automation);
      apiFetch<WhatsAppAssistantStats>("/api/whatsapp-assistant/stats")
        .then(setWhatsAppStats)
        .catch(() => undefined);
      setLastUpdatedAt(new Date());
    } catch (err) {
      if (isAuthError(err)) {
        clearToken();
        router.replace("/");
        return;
      }
      setError(err instanceof Error ? err.message : "טעינת הדשבורד נכשלה");
    }
  }, [router]);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function startFirstScan() {
    setFirstScanRunning(true);
    const progressMessage = "מתחבר ל-Gmail...";
    setFirstScanSummary(progressMessage);
    setScanProgress([progressMessage]);
    setScanToast({ type: "info", text: progressMessage });
    setError("");
    try {
      const addProgress = (message: string) => setScanProgress((items) => [...items, message]);
      addProgress("מחפש מיילים מ-90 הימים האחרונים...");
      const result = await apiFetch<{
        emailsProcessed: number;
        emailsFound?: number;
        clientsCreated?: number;
        invoicesCreated?: number;
        potentialClients?: number;
        invoiceEmails?: number;
        inProgress?: boolean;
        message?: string;
      }>(
        "/api/gmail/scan",
        { method: "POST", body: JSON.stringify({ daysBack: 90 }) }
      );
      addProgress(`נמצאו ${result.emailsFound ?? result.emailsProcessed} מיילים`);
      addProgress("מזהה לקוחות...");
      addProgress(`נמצאו ${result.potentialClients ?? result.clientsCreated ?? 0} לקוחות`);
      addProgress("מזהה חשבוניות...");
      addProgress(`נמצאו ${result.invoicesCreated ?? result.invoiceEmails ?? 0} חשבוניות`);
      addProgress("✅ הסריקה הושלמה!");
      await load();
      const updatedClients = await apiFetch<ClientsResponse>("/api/clients");
      setClients(updatedClients);
      const scanned = result.emailsFound ?? result.emailsProcessed;
      const clientsFound = result.potentialClients ?? updatedClients.clients.length;
      const invoicesFound = result.invoicesCreated ?? updatedClients.totals.invoices;
      const successMessage = `✅ הסריקה הושלמה! נמצאו ${clientsFound} לקוחות ו-${invoicesFound} חשבוניות`;
      setFirstScanSummary(`נסרקו ${scanned} מיילים | נמצאו ${clientsFound} לקוחות | ${invoicesFound} חשבוניות`);
      setScanToast({ type: "success", text: successMessage });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "סריקה ראשונית נכשלה";
      setScanProgress((items) => [...items, errorMessage]);
      setScanToast({ type: "error", text: errorMessage });
    } finally {
      setFirstScanRunning(false);
    }
  }

  async function runSync() {
    console.log("Scanning Gmail...");
    console.log("Token:", localStorage.getItem("token"));
    setSyncing(true);
    setError("");
    try {
      const result = await apiFetch<{
        emailsProcessed: number;
        emailsFound?: number;
        paymentsCreated: number;
        tasksCreated: number;
        inProgress?: boolean;
        message?: string;
      }>("/api/gmail/scan", { method: "POST" });
      await load();
      setError(
        result.inProgress
          ? "סריקת Gmail כבר רצה. נסה שוב בעוד רגע."
          : result.message ??
              `נמצאו ${result.emailsFound ?? result.emailsProcessed} מיילים ✅`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function scanAllClients() {
    setSyncing(true);
    setError("");
    try {
      const result = await apiFetch<{ success: boolean; results?: Array<{ message?: string }> }>(
        "/api/clients/scan-all",
        { method: "POST" }
      );
      await load();
      setError(result.results?.find((item) => item.message)?.message ?? "סריקת כל הלקוחות הסתיימה");
    } catch (e) {
      setError(e instanceof Error ? e.message : "סריקת לקוחות נכשלה");
    } finally {
      setSyncing(false);
    }
  }

  if (!stats) {
    return (
      <div className="container">
        <p>{error || "טוען..."}</p>
      </div>
    );
  }

  const kpis = [
    { label: "לקוחות", value: clients?.clients.length ?? 0, icon: Activity, detail: `${clients?.totals.openTasks ?? 0} משימות פתוחות`, tone: "text-blue-300" },
    { label: "כסף לקבל", value: `₪${stats.moneyToReceive.toLocaleString("he-IL")}`, icon: ArrowUpRight, detail: "הכנסות צפויות", tone: "text-emerald-300" },
    { label: "כסף לשלם", value: `₪${stats.moneyToPay.toLocaleString("he-IL")}`, icon: WalletCards, detail: `${stats.upcomingPaymentsCount} תשלומים קרובים`, tone: "text-amber-300" },
    { label: "בריאות עסקית", value: `${stats.businessHealthScore}/100`, icon: HeartPulse, detail: `נחסכו ${stats.hoursSavedThisWeek} שעות`, tone: "text-violet-300" },
  ];
  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-[var(--border)] bg-[rgba(22,22,30,0.72)] p-5 shadow-card backdrop-blur">
            <Logo size="lg" showSubtitle />
            <div className="mt-3 text-[12px] font-bold uppercase tracking-[0.24em] text-blue-300">Business command center</div>
          </div>
          <div>
            <h1>לוח בקרה</h1>
            <p>ניהול חשבוניות, לקוחות, תשלומים ואוטומציות במקום אחד.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn" onClick={runSync} disabled={syncing}><ScanLine className="h-4 w-4" />{syncing ? "סורק..." : "סרוק Gmail"}</button>
          <button className="btn btn-secondary" onClick={scanAllClients} disabled={syncing}><RefreshCcw className="h-4 w-4" />סרוק לקוחות</button>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/clients")}><Plus className="h-4 w-4" />הוסף לקוח</button>
        </div>
      </div>

      <section className="mb-6 rounded-2xl border border-[#818CF8]/70 bg-[linear-gradient(135deg,rgba(99,102,241,0.98),rgba(139,92,246,0.94))] p-3 text-white shadow-[0_14px_34px_rgba(99,102,241,0.28)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-0.5 text-[13px] font-semibold text-white">
              <Clock3 className="h-3.5 w-3.5" />
              סריקה ראשונית 90 יום
            </div>
            <h2 className="text-[16px] font-bold text-white">הפעל סריקה ראשונית - 90 יום אחורה</h2>
            <p className="mt-1 text-[13px] font-medium text-white/85">
              סרוק את כל המיילים מ-90 הימים האחרונים למציאת לקוחות וחשבוניות
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[#818CF8] bg-[#6366F1] px-4 text-[14px] font-bold text-white shadow-[0_10px_22px_rgba(15,23,42,0.22)] transition hover:scale-[1.01] hover:bg-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-80 lg:w-auto lg:min-w-64"
            onClick={startFirstScan}
            disabled={firstScanRunning || syncing}
          >
            {firstScanRunning && <RefreshCcw className="h-4 w-4 animate-spin" />}
            {firstScanRunning ? "סורק מיילים..." : "🕐 הפעל סריקה ראשונית - 90 יום"}
          </button>
        </div>
        {firstScanRunning && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[13px] font-semibold text-white">
              <span>סורק Gmail ומעדכן נתונים...</span>
              <span>90 יום</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/20">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.7)]" />
            </div>
          </div>
        )}
        {scanProgress.length > 0 && (
          <div className="mt-3 grid gap-1.5 rounded-xl border border-white/25 bg-white/10 p-3 text-[13px] font-semibold text-white">
            {scanProgress.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        )}
        {firstScanSummary && (
          <div className="mt-3 rounded-xl border border-white/25 bg-white/15 p-3 text-[13px] font-bold text-white">
            {firstScanSummary}
          </div>
        )}
      </section>

      {error && <div className="toast border-red-400/30 text-red-200">{error}</div>}
      {scanToast && (
        <div
          className={[
            "toast",
            scanToast.type === "success" ? "border-emerald-400/30 text-emerald-200" : "",
            scanToast.type === "error" ? "border-red-400/30 text-red-200" : "",
            scanToast.type === "info" ? "border-[#818CF8]/40 text-white" : "",
          ].join(" ")}
        >
          {scanToast.text}
        </div>
      )}

      <section className="grid mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="card overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#6366F1,#8B5CF6,transparent)]" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="stat-label">{kpi.label}</div>
                  <div className="stat-value">{kpi.value}</div>
                  <p className="mt-2 text-sm">{kpi.detail}</p>
                </div>
                <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-surface-hover ${kpi.tone}`}>
                  <Icon className="h-5 w-5" />
                </span>
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <div className="card">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2>לקוחות אחרונים</h2>
              <p className="text-sm">סטטוס פעילות וסיכום מהיר לכל לקוח.</p>
            </div>
          </div>
          <div className="space-y-3">
            {(clients?.clients ?? []).slice(0, 5).map((client) => (
              <div key={client.id} className="group flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary/60 p-4 transition hover:border-accent-primary/40 hover:bg-surface-hover">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] text-sm font-bold text-white">
                    {client.name.slice(0, 2)}
                  </span>
                  <div>
                    <strong className="text-ink-primary">{client.name}</strong>
                    <p className="text-sm">₪{(client.stats?.toPay ?? 0).toLocaleString("he-IL")} לתשלום · {client.stats?.invoices ?? 0} חשבוניות</p>
                  </div>
                </div>
                <span className="badge badge-ok">{client.stats?.missingInvoices ? `${client.stats.missingInvoices} חסרות` : "תקין"}</span>
              </div>
            ))}
            {clients?.clients.length === 0 && <p>אין לקוחות עדיין.</p>}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <div className="mb-4 flex items-center gap-3">
              <Clock3 className="h-5 w-5 text-accent-primary" />
              <h2>סטטוס אוטומציה</h2>
            </div>
            <div className="space-y-3 text-sm text-ink-secondary">
              <div className="flex justify-between"><span>Live</span><span className="text-emerald-300">פעיל</span></div>
              <div className="flex justify-between"><span>עודכן לאחרונה</span><span>{lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען..."}</span></div>
              <div className="flex justify-between"><span>סריקה הבאה</span><span>{scanStatus ? new Date(scanStatus.nextScheduledScanAt).toLocaleString("he-IL") : "טוען..."}</span></div>
              {scanStatus?.last && <div className="rounded-xl bg-surface-hover p-3">נמצאו {scanStatus.last.found} · נשמרו {scanStatus.last.saved}</div>}
            </div>
          </div>
          <div className="card">
            <div className="mb-4 flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-emerald-300" />
              <h2>WhatsApp</h2>
            </div>
            <div className="stat-value">{whatsAppStats?.sentToday ?? 0}</div>
            <p>הודעות נשלחו היום · {whatsAppStats?.activeChats ?? 0} שיחות פעילות</p>
            <button className="btn btn-secondary mt-4" onClick={() => router.push("/dashboard/settings")}>ראה כל השיחות</button>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
        <div className="card">
          <h2>פעולות מהירות</h2>
          <div className="mt-4 grid gap-3">
            <a className="btn" href="https://ai-office-worker-backend.onrender.com/auth/google">התחבר עם Google</a>
            <button className="btn btn-secondary" onClick={() => router.push("/camera")}><FileText className="h-4 w-4" />צלם/העלה חשבונית</button>
          </div>
        </div>
        <div className="card">
          <h2>סיכום יומי</h2>
          <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-ink-secondary">{summary}</pre>
        </div>
      </section>
    </div>
  );
}

function relativeTime(date: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes === 0) return "עכשיו";
  if (minutes === 1) return "לפני דקה";
  return `לפני ${minutes} דקות`;
}
