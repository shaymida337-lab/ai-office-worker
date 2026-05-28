"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import {
  apiFetch,
  clearToken,
  getToken,
  isAuthError,
  type DashboardStats,
  type GmailStatus,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import { Activity, ArrowUpRight, Building2, Clock3, FileText, HeartPulse, MessageCircle, Plus, RefreshCcw, ScanLine, WalletCards } from "lucide-react";

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

type GmailScanSummary = {
  totalEmailsChecked?: number;
  emailsScanned: number;
  relevantEmailsFound?: number;
  invoiceOrPaymentEmailsFound: number;
  invoicesFound?: number;
  receiptsFound?: number;
  paymentRequestsFound?: number;
  recordsSaved: number;
  paymentsSaved: number;
  invoicesSaved: number;
  duplicatesSkipped: number;
  needsReviewCount?: number;
  errorsCount?: number;
};

type GmailScanResult = {
  emailsProcessed: number;
  emailsFound?: number;
  paymentsCreated?: number;
  tasksCreated?: number;
  clientsCreated?: number;
  invoicesCreated?: number;
  potentialClients?: number;
  invoiceEmails?: number;
  duplicatesSkipped?: number;
  recordsSaved?: number;
  scanSteps?: string[];
  inProgress?: boolean;
  backgroundProcessing?: boolean;
  quick?: boolean;
  message?: string;
  summary?: GmailScanSummary;
};

const emptyStats: DashboardStats = {
  moneyToPay: 0,
  moneyToReceive: 0,
  pendingInvoices: 0,
  missingInvoicesCount: 0,
  upcomingPaymentsCount: 0,
  openTasks: 0,
  unreadAlerts: 0,
  businessHealthScore: 100,
  overdueCustomerInvoices: 0,
  overdueSupplierPayments: 0,
  hoursSavedThisWeek: 0,
  currency: "ILS",
};

const emptyClients: ClientsResponse = {
  clients: [],
  totals: {
    toPay: 0,
    openTasks: 0,
    invoices: 0,
    missingInvoices: 0,
  },
};

function emptyScanStatus(): ScanStatus {
  const nextScheduledScanAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return { last: null, logs: [], nextScheduledScanAt };
}

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
  const [showGmailConnect, setShowGmailConnect] = useState(false);
  const [error, setError] = useState("");

  const refreshGmailStatus = useCallback(async () => {
    const status = await apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`);
    setGmailStatus(status);
    if (status.connected) {
      setShowGmailConnect(false);
      setError("");
      setScanToast((current) => current?.type === "error" && current.text.includes("Gmail") ? null : current);
    }
    return status;
  }, []);

  const load = useCallback(async () => {
    try {
      const [statsResult, summaryResult, gmailResult, clientsResult, scanStatusResult] = await Promise.allSettled([
        apiFetch<DashboardStats>("/api/stats"),
        apiFetch<{ text: string }>("/api/summary/daily"),
        apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`),
        apiFetch<ClientsResponse>("/api/clients"),
        apiFetch<ScanStatus>("/api/automation/scan-status"),
      ]);

      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      } else {
        console.error("[dashboard] /api/stats failed", statsResult.reason);
        setStats(emptyStats);
      }

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value.text);
      } else {
        console.error("[dashboard] /api/summary/daily failed", summaryResult.reason);
        setSummary("לא ניתן לטעון סיכום כרגע.");
      }

      if (gmailResult.status === "fulfilled") {
        setGmailStatus(gmailResult.value);
      } else {
        console.error("[dashboard] /api/integrations/gmail/status failed", gmailResult.reason);
        setGmailStatus({ googleConfigured: true, connected: false, connectedAt: null });
      }

      if (clientsResult.status === "fulfilled") {
        setClients(clientsResult.value);
      } else {
        console.error("[dashboard] /api/clients failed", clientsResult.reason);
        setClients(emptyClients);
      }

      if (scanStatusResult.status === "fulfilled") {
        setScanStatus(scanStatusResult.value);
      } else {
        console.error("[dashboard] /api/automation/scan-status failed", scanStatusResult.reason);
        setScanStatus(emptyScanStatus());
      }

      apiFetch<WhatsAppAssistantStats>("/api/whatsapp-assistant/stats")
        .then(setWhatsAppStats)
        .catch(() => undefined);
      setLastUpdatedAt(new Date());
      setError("");
    } catch (err) {
      if (isAuthError(err)) {
        clearToken();
        router.replace("/");
        return;
      }
      setStats(emptyStats);
      setClients(emptyClients);
      setScanStatus(emptyScanStatus());
      setError(err instanceof Error ? err.message : "טעינת הדשבורד נכשלה");
    }
  }, [router]);

  useEffect(() => {
    if (window.location.search.includes("gmail=connected")) {
      setScanToast({ type: "success", text: "Gmail חובר בהצלחה" });
      refreshGmailStatus().catch(() => undefined);
      router.replace("/dashboard");
    }
    load();
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [load, refreshGmailStatus, router]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshGmailStatus().catch(() => undefined);
      }
    };
    const refreshOnPageShow = () => refreshGmailStatus().catch(() => undefined);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshOnPageShow);
    window.addEventListener("pageshow", refreshOnPageShow);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshOnPageShow);
      window.removeEventListener("pageshow", refreshOnPageShow);
    };
  }, [refreshGmailStatus]);

  async function startFirstScan() {
    const freshGmailStatus = gmailStatus?.connected ? gmailStatus : await refreshGmailStatus().catch(() => gmailStatus);
    if (freshGmailStatus && !freshGmailStatus.connected) {
      const message = "Please connect Gmail account first";
      setShowGmailConnect(true);
      setFirstScanSummary(message);
      setScanProgress([message]);
      setScanToast({ type: "error", text: message });
      return;
    }

    setFirstScanRunning(true);
    const progressMessage = "מתחבר ל-Gmail...";
    setFirstScanSummary(progressMessage);
    setScanProgress([progressMessage]);
    setScanToast({ type: "info", text: progressMessage });
    setShowGmailConnect(false);
    setError("");
    try {
      const addProgress = (message: string) => setScanProgress((items) => [...items, message]);
      addProgress("מחפש מיילים...");
      const result = await apiFetch<GmailScanResult>(
        "/api/gmail/scan",
        { method: "POST", body: JSON.stringify({ daysBack: 90 }) }
      );
      const summary = scanSummaryFromResult(result);
      const scanned = summary.emailsScanned;
      addProgress(`נבדקו ${summary.totalEmailsChecked ?? scanned} מיילים`);
      addProgress("מזהה לקוחות...");
      addProgress(`נמצאו ${result.potentialClients ?? result.clientsCreated ?? 0} לקוחות`);
      addProgress("מזהה חשבוניות...");
      addProgress(`נמצאו ${summary.relevantEmailsFound ?? summary.invoiceOrPaymentEmailsFound} מיילים רלוונטיים`);
      addProgress(`${summary.invoicesFound ?? 0} חשבוניות · ${summary.receiptsFound ?? 0} קבלות · ${summary.paymentRequestsFound ?? 0} דרישות תשלום`);
      addProgress("שומר נתונים...");
      addProgress(`נשמרו ${summary.recordsSaved} רשומות חדשות, דולגו ${summary.duplicatesSkipped} כפילויות, ${summary.needsReviewCount ?? 0} לבדיקה`);
      addProgress("✅ הסריקה הושלמה!");
      await load();
      const updatedClients = await apiFetch<ClientsResponse>("/api/clients");
      setClients(updatedClients);
      const clientsFound = result.potentialClients ?? updatedClients.clients.length;
      const tasksFound = result.tasksCreated ?? 0;
      const successMessage = formatScanSuccess(summary);
      setFirstScanSummary(`נבדקו ${summary.totalEmailsChecked ?? scanned} מיילים | ${summary.relevantEmailsFound ?? summary.invoiceOrPaymentEmailsFound} רלוונטיים | נשמרו ${summary.recordsSaved} רשומות | לבדיקה ${summary.needsReviewCount ?? 0} | שגיאות ${summary.errorsCount ?? 0} | ${clientsFound} לקוחות | ${tasksFound} משימות`);
      setScanToast({ type: "success", text: successMessage });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "סריקה ראשונית נכשלה";
      if (errorMessage.includes("Gmail") || errorMessage.includes("להתחבר")) {
        setShowGmailConnect(true);
      }
      setScanProgress((items) => [...items, errorMessage]);
      setScanToast({ type: "error", text: errorMessage });
    } finally {
      setFirstScanRunning(false);
    }
  }

  async function connectGmail() {
    console.log("מנסה להתחבר לGmail...");
    const token = getToken();
    console.log("token:", token ? "קיים" : "חסר!");

    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/dashboard?connect=gmail")}`);
      return;
    }

    try {
      setError("");
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${apiUrl}/api/integrations/gmail/connect-url`, {
        method: "GET",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      console.log("Gmail connect-url status:", res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((errorData as { error?: string }).error ?? "חיבור Gmail נכשל");
      }

      const data = await res.json() as { url?: string };
      console.log("Gmail OAuth URL:", data.url ? "התקבל" : "חסר!");

      if (!data.url) {
        throw new Error("שרת לא החזיר כתובת OAuth");
      }

      window.location.href = data.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google OAuth is not configured";
      console.error("Gmail connect failed:", err);
      alert(message);
      setError(message);
      setShowGmailConnect(true);
    }
  }

  async function runSync() {
    const freshGmailStatus = gmailStatus?.connected ? gmailStatus : await refreshGmailStatus().catch(() => gmailStatus);
    if (freshGmailStatus && !freshGmailStatus.connected) {
      const message = "Please connect Gmail account first";
      setShowGmailConnect(true);
      setError(message);
      setScanToast({ type: "error", text: message });
      return;
    }

    setSyncing(true);
    setError("");
    setScanToast({ type: "info", text: "סורק Gmail ומחפש חשבוניות, קבלות ודרישות תשלום..." });
    try {
      const result = await apiFetch<GmailScanResult>("/api/gmail/scan", { method: "POST" });
      await load();
      if (result.inProgress) {
        const message = "סריקת Gmail כבר רצה. נסה שוב בעוד רגע.";
        setError(message);
        setScanToast({ type: "info", text: message });
        return;
      }
      const summary = scanSummaryFromResult(result);
      const message = result.message ?? (result.backgroundProcessing
        ? `נמצאו ${summary.emailsScanned} מיילים ב-Gmail. העיבוד המלא ממשיך ברקע ויעדכן חשבוניות/תשלומים.`
        : formatScanSuccess(summary));
      setError(message);
      setScanToast({ type: "success", text: message });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      setError(message);
      setScanToast({ type: "error", text: message });
      if (message.includes("Gmail") || message.includes("הרשאות") || message.includes("מחובר")) {
        setShowGmailConnect(true);
      }
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
  const gmailConnected = Boolean(gmailStatus?.connected);
  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-3xl border border-[var(--border)] bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(22,22,30,0.88))] p-4 shadow-card backdrop-blur">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-ink-primary">
              <Building2 className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-bold uppercase tracking-[0.22em] text-ink-muted">Business command center</div>
              <div className="mt-1 text-sm text-ink-secondary">ניהול העסק במקום אחד</div>
            </div>
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

      {gmailStatus && !gmailConnected && (
        <section className="mb-4 rounded-2xl bg-[linear-gradient(135deg,#4285F4,#34A853)] p-5 text-white shadow-[0_18px_40px_rgba(66,133,244,0.28)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="m-0 text-xl font-bold text-white">📧 חבר את Gmail שלך</h3>
              <p className="mt-1 text-sm font-medium text-white/85">
                כדי לסרוק מיילים ולמצוא לידים ותשלומים
              </p>
            </div>
            <button
              type="button"
              onClick={connectGmail}
              className="min-h-11 whitespace-nowrap rounded-xl border-none bg-white px-5 py-3 text-sm font-bold text-[#4285F4] shadow-[0_10px_24px_rgba(15,23,42,0.16)] transition hover:bg-white/90 active:scale-[0.99]"
            >
              🔗 התחבר עכשיו
            </button>
          </div>
        </section>
      )}

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
            <p className="mt-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-[13px] font-semibold text-white">
              המערכת אוטומטית מאוד, אבל פריטים לא ודאיים צריכים לעבור בדיקה.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#818CF8] bg-[#6366F1] px-4 py-3 text-[16px] font-bold text-white shadow-[0_10px_22px_rgba(15,23,42,0.22)] transition hover:scale-[1.01] hover:bg-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-80 lg:w-auto lg:min-w-64"
            onClick={startFirstScan}
            disabled={firstScanRunning || syncing}
          >
            {firstScanRunning && <RefreshCcw className="h-4 w-4 animate-spin" />}
            {firstScanRunning ? "סורק מיילים..." : "הפעל סריקה ראשונית - 90 יום"}
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
            {scanProgress.map((item, index) => (
              <div key={`${item}-${index}`}>{item}</div>
            ))}
            {showGmailConnect && (
              <button type="button" onClick={connectGmail} className="mt-2 min-h-11 w-full rounded-xl bg-white px-4 py-3 text-[16px] font-bold text-[#4F46E5] transition hover:bg-white/90 sm:w-auto">
                התחבר ל-Gmail
              </button>
            )}
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
              <div key={client.id} className="group grid gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary/60 p-4 transition hover:border-accent-primary/40 hover:bg-surface-hover sm:flex sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] text-sm font-bold text-white">
                    {client.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <strong className="block truncate text-ink-primary">{client.name}</strong>
                    <p className="text-sm">₪{(client.stats?.toPay ?? 0).toLocaleString("he-IL")} לתשלום · {client.stats?.invoices ?? 0} חשבוניות</p>
                  </div>
                </div>
                <span className={`badge w-fit ${client.stats?.missingInvoices ? "badge-warn" : "badge-ok"}`}>{client.stats?.missingInvoices ? `${client.stats.missingInvoices} חסרות` : "תקין"}</span>
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
            <button className="btn" onClick={connectGmail}>התחבר עם Google</button>
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

function scanSummaryFromResult(result: GmailScanResult): GmailScanSummary {
  return {
    totalEmailsChecked: result.summary?.totalEmailsChecked ?? result.emailsFound ?? result.emailsProcessed ?? 0,
    emailsScanned: result.summary?.emailsScanned ?? result.emailsFound ?? result.emailsProcessed ?? 0,
    relevantEmailsFound: result.summary?.relevantEmailsFound ?? result.summary?.invoiceOrPaymentEmailsFound ?? result.invoiceEmails ?? 0,
    invoiceOrPaymentEmailsFound: result.summary?.invoiceOrPaymentEmailsFound ?? result.invoiceEmails ?? 0,
    invoicesFound: result.summary?.invoicesFound ?? result.invoicesCreated ?? 0,
    receiptsFound: result.summary?.receiptsFound ?? 0,
    paymentRequestsFound: result.summary?.paymentRequestsFound ?? 0,
    recordsSaved: result.summary?.recordsSaved ?? result.recordsSaved ?? ((result.paymentsCreated ?? 0) + (result.invoicesCreated ?? 0) + (result.tasksCreated ?? 0) + (result.clientsCreated ?? 0)),
    paymentsSaved: result.summary?.paymentsSaved ?? result.paymentsCreated ?? 0,
    invoicesSaved: result.summary?.invoicesSaved ?? result.invoicesCreated ?? 0,
    duplicatesSkipped: result.summary?.duplicatesSkipped ?? result.duplicatesSkipped ?? 0,
    needsReviewCount: result.summary?.needsReviewCount ?? 0,
    errorsCount: result.summary?.errorsCount ?? 0,
  };
}

function formatScanSuccess(summary: GmailScanSummary) {
  return `✅ נבדקו ${summary.totalEmailsChecked ?? summary.emailsScanned} מיילים | נמצאו ${summary.relevantEmailsFound ?? summary.invoiceOrPaymentEmailsFound} רלוונטיים | נשמרו ${summary.recordsSaved} רשומות | לבדיקה ${summary.needsReviewCount ?? 0} | שגיאות ${summary.errorsCount ?? 0}`;
}
