"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import {
  apiFetch,
  clearToken,
  getToken,
  isAuthError,
  type DashboardStats,
  type GmailStatus,
  type Payment,
  type Task,
} from "@/lib/api";
import { businessModules, businessTypeLabel, getBusinessProfile, normalizeEnabledModules, uiTranslations, type BusinessKpiConfig, type BusinessModuleId, type DashboardKpiMetric, type OrganizationSettings } from "@/lib/business-config";
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
    invoicesFound?: number;
    paymentsFound?: number;
    driveUploaded?: number;
    sheetsUpdated?: number;
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
    invoicesFound?: number;
    paymentsFound?: number;
    driveUploaded?: number;
    sheetsUpdated?: number;
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
  emailsFetched?: number;
  emailsSaved?: number;
  clientsFound?: number;
  supplierPaymentsFound?: number;
  uploadedToDrive?: number;
  rejectedReasons?: Record<string, number>;
};

type GmailScanResult = {
  emailsProcessed?: number;
  emailsFound?: number;
  scanId?: string;
  status?: string;
  progressUrl?: string;
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

type ScanProgressResult = {
  scanId: string;
  status: "running" | "completed" | "error";
  inProgress: boolean;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  emailsFetched: number;
  emailsSaved: number;
  invoicesFound: number;
  supplierPaymentsFound: number;
  clientsFound: number;
  uploadedToDrive: number;
  sheetsUpdated?: number;
  failedItems?: Array<{
    id: string;
    gmailMessageId: string;
    gmailMessageLink: string;
    sender: string;
    subject: string;
    documentType: string;
    decisionReason: string;
    reviewStatus: string;
    occurredAt: string;
  }>;
  finalSummary?: {
    emailsFetched: number;
    emailsSaved: number;
    invoicesFound: number;
    paymentsFound: number;
    uploadedToDrive: number;
    sheetsUpdated: number;
    failedItems: number;
    errorsCount: number;
    completedAt: string;
  } | null;
  lastSuccessfulScanAt?: string | null;
  rejectedReasons: Record<string, number>;
  progressPercent?: number;
  estimatedRemainingSeconds?: number | null;
  summary?: GmailScanSummary;
};

type RecentInvoice = {
  id: string;
  amount: number;
  currency: string;
  date: string;
  status: string;
  description: string | null;
  driveUrl: string | null;
  client?: { id: string; name: string; color: string | null };
};

type AlertItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
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
  supplierPaymentsCount: 0,
  totalInvoices: 0,
  unpaidPayments: 0,
  paidPayments: 0,
  scansCompleted: 0,
  driveUploads: 0,
  clients: 0,
  suspiciousPaymentsCount: 0,
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
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [whatsAppStats, setWhatsAppStats] = useState<WhatsAppAssistantStats | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [firstScanRunning, setFirstScanRunning] = useState(false);
  const [firstScanSummary, setFirstScanSummary] = useState("");
  const [scanProgress, setScanProgress] = useState<string[]>([]);
  const [scanToast, setScanToast] = useState<ScanToast | null>(null);
  const [scanRangeDays, setScanRangeDays] = useState(90);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [activeScan, setActiveScan] = useState<ScanProgressResult | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [missingInvoices, setMissingInvoices] = useState<Payment[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([]);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [actionMessage, setActionMessage] = useState("");
  const [showGmailConnect, setShowGmailConnect] = useState(false);
  const [error, setError] = useState("");
  const [invoiceAttachPaymentId, setInvoiceAttachPaymentId] = useState<string | null>(null);
  const [invoiceAttachLink, setInvoiceAttachLink] = useState("");

  useEffect(() => {
    const savedScanId = window.localStorage.getItem("activeGmailScanId");
    if (savedScanId) setActiveScanId(savedScanId);
  }, []);

  const refreshGmailStatus = useCallback(async () => {
    const status = await apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`);
    setGmailStatus(status);
    if (status.connected) {
      setShowGmailConnect(false);
      setError("");
      setScanToast((current) => current?.type === "error" && current.text.includes("ג׳ימייל") ? null : current);
    }
    return status;
  }, []);

  const load = useCallback(async () => {
    try {
      const [statsResult, summaryResult, gmailResult, clientsResult, scanStatusResult, paymentsResult, missingResult, invoicesResult, tasksResult, alertsResult, orgResult] = await Promise.allSettled([
        apiFetch<DashboardStats>("/api/stats"),
        apiFetch<{ text: string }>("/api/summary/daily"),
        apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`),
        apiFetch<ClientsResponse>("/api/clients"),
        apiFetch<ScanStatus>("/api/automation/scan-status"),
        apiFetch<Payment[]>("/api/payments"),
        apiFetch<Payment[]>("/api/reports/missing-invoices"),
        apiFetch<{ invoices: RecentInvoice[] }>("/api/invoices"),
        apiFetch<Task[]>("/api/tasks"),
        apiFetch<AlertItem[]>("/api/alerts"),
        apiFetch<OrganizationSettings>("/api/organization/settings"),
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
        const running = scanStatusResult.value.logs.find((log) => log.status === "running" && !log.endedAt);
        if (running && !activeScanId) {
          setActiveScanId(running.id);
          window.localStorage.setItem("activeGmailScanId", running.id);
        }
      } else {
        console.error("[dashboard] /api/automation/scan-status failed", scanStatusResult.reason);
        setScanStatus(emptyScanStatus());
      }

      setPayments(paymentsResult.status === "fulfilled" ? paymentsResult.value : []);
      setMissingInvoices(missingResult.status === "fulfilled" ? missingResult.value : []);
      setRecentInvoices(invoicesResult.status === "fulfilled" ? invoicesResult.value.invoices.slice(0, 8) : []);
      setRecentTasks(tasksResult.status === "fulfilled" ? tasksResult.value.slice(0, 8) : []);
      setAlerts(alertsResult.status === "fulfilled" ? alertsResult.value.slice(0, 8) : []);
      if (orgResult.status === "fulfilled") {
        setOrganizationSettings(orgResult.value);
        if (orgResult.value.onboardingRequired) {
          router.replace("/onboarding");
          return;
        }
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
      setScanToast({ type: "success", text: "ג׳ימייל חובר בהצלחה" });
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

  useEffect(() => {
    if (!activeScanId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const progress = await apiFetch<ScanProgressResult>(`/api/gmail/scan/${activeScanId}`);
        if (cancelled) return;
        setActiveScan(progress);
        setScanProgress(scanProgressMessages(progress));
        if (progress.status === "completed") {
          setFirstScanRunning(false);
          setSyncing(false);
          setFirstScanSummary(formatProgressSummary(progress));
          setScanToast({ type: "success", text: "הסריקה הסתיימה והנתונים עודכנו" });
          setActiveScanId(null);
          window.localStorage.removeItem("activeGmailScanId");
          await load();
        } else if (progress.status === "error") {
          setFirstScanRunning(false);
          setSyncing(false);
          setScanToast({ type: "error", text: progress.error ?? "הסריקה נכשלה" });
          setActiveScanId(null);
          window.localStorage.removeItem("activeGmailScanId");
        }
      } catch (err) {
        if (!cancelled) setScanToast({ type: "error", text: err instanceof Error ? err.message : "טעינת סטטוס סריקה נכשלה" });
      }
    };
    poll().catch(() => undefined);
    const interval = window.setInterval(() => poll().catch(() => undefined), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeScanId, load]);

  async function startFirstScan() {
    const freshGmailStatus = gmailStatus?.connected ? gmailStatus : await refreshGmailStatus().catch(() => gmailStatus);
    if (freshGmailStatus && !freshGmailStatus.connected) {
      const message = "יש לחבר חשבון ג׳ימייל לפני הסריקה";
      setShowGmailConnect(true);
      setFirstScanSummary(message);
      setScanProgress([message]);
      setScanToast({ type: "error", text: message });
      return;
    }

    setFirstScanRunning(true);
    const progressMessage = "מתחבר לג׳ימייל...";
    setFirstScanSummary(progressMessage);
    setScanProgress([progressMessage]);
    setScanToast({ type: "info", text: progressMessage });
    setShowGmailConnect(false);
    setError("");
    let startedScanId: string | null = null;
    try {
      const addProgress = (message: string) => setScanProgress((items) => [...items, message]);
      addProgress("יוצר סריקה ברקע...");
      const result = await apiFetch<GmailScanResult>(
        "/api/gmail/scan",
        { method: "POST", body: JSON.stringify({ daysBack: scanRangeDays }) }
      );
      if (result.scanId) {
        startedScanId = result.scanId;
        setActiveScanId(result.scanId);
        window.localStorage.setItem("activeGmailScanId", result.scanId);
        setFirstScanSummary(`סריקה התחילה ברקע (${scanRangeDays} ימים). אפשר להמשיך לעבוד בדשבורד.`);
        setScanToast({ type: "info", text: "הסריקה רצה ברקע. הסטטוס יתעדכן אוטומטית." });
        return;
      }
      const summary = scanSummaryFromResult(result);
      setFirstScanSummary(formatScanSuccess(summary));
      setScanToast({ type: "success", text: formatScanSuccess(summary) });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "סריקה ראשונית נכשלה";
      if (errorMessage.includes("Gmail") || errorMessage.includes("ג׳ימייל") || errorMessage.includes("להתחבר")) {
        setShowGmailConnect(true);
      }
      setScanProgress((items) => [...items, errorMessage]);
      setScanToast({ type: "error", text: errorMessage });
    } finally {
      if (!startedScanId) setFirstScanRunning(false);
    }
  }

  async function connectGmail() {
    const token = getToken();

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

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((errorData as { error?: string }).error ?? "חיבור ג׳ימייל נכשל");
      }

      const data = await res.json() as { url?: string };

      if (!data.url) {
        throw new Error("שרת לא החזיר כתובת חיבור לגוגל");
      }

      window.location.href = data.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "התחברות גוגל לא מוגדרת";
      setError(message);
      setScanToast({ type: "error", text: message });
      setShowGmailConnect(true);
    }
  }

  async function runSync() {
    const freshGmailStatus = gmailStatus?.connected ? gmailStatus : await refreshGmailStatus().catch(() => gmailStatus);
    if (freshGmailStatus && !freshGmailStatus.connected) {
      const message = "יש לחבר חשבון ג׳ימייל לפני הסריקה";
      setShowGmailConnect(true);
      setError(message);
      setScanToast({ type: "error", text: message });
      return;
    }

    setSyncing(true);
    setError("");
    setScanToast({ type: "info", text: "סורק ג׳ימייל ומחפש חשבוניות, קבלות ודרישות תשלום..." });
    try {
      const result = await apiFetch<GmailScanResult>("/api/gmail/scan", { method: "POST" });
      if (result.scanId) {
        setActiveScanId(result.scanId);
        window.localStorage.setItem("activeGmailScanId", result.scanId);
        const message = result.inProgress ? "סריקת ג׳ימייל כבר רצה. מציג סטטוס חי." : "סריקת ג׳ימייל התחילה ברקע.";
        setError(message);
        setScanToast({ type: "info", text: message });
        return;
      }
      await load();
      const summary = scanSummaryFromResult(result);
      const message = result.message ?? (result.backgroundProcessing
        ? `נמצאו ${summary.emailsScanned} מיילים בג׳ימייל. העיבוד המלא ממשיך ברקע ויעדכן חשבוניות/תשלומים.`
        : formatScanSuccess(summary));
      setError(message);
      setScanToast({ type: "success", text: message });
    } catch (e) {
      const message = e instanceof Error ? e.message : "סריקת ג׳ימייל נכשלה";
      setError(message);
      setScanToast({ type: "error", text: message });
      if (message.includes("Gmail") || message.includes("ג׳ימייל") || message.includes("הרשאות") || message.includes("מחובר")) {
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

  async function markPaymentPaid(paymentId: string) {
    setActionMessage("");
    try {
      await apiFetch(`/api/payments/${paymentId}`, { method: "PATCH", body: JSON.stringify({ paid: true }) });
      await load();
      setActionMessage("התשלום סומן כשולם");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "עדכון תשלום נכשל");
    }
  }

  async function attachInvoiceToPayment(paymentId: string) {
    setInvoiceAttachPaymentId(paymentId);
    setInvoiceAttachLink("");
  }

  async function submitInvoiceAttachment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceAttachPaymentId || !invoiceAttachLink.trim()) return;
    setActionMessage("");
    try {
      await apiFetch(`/api/payments/${invoiceAttachPaymentId}`, { method: "PATCH", body: JSON.stringify({ invoiceLink: invoiceAttachLink.trim() }) });
      await load();
      setActionMessage("החשבונית צורפה לתשלום");
      setInvoiceAttachPaymentId(null);
      setInvoiceAttachLink("");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "צירוף חשבונית נכשל");
    }
  }

  if (!stats) {
    return (
      <div className="container">
        <p>{error || "טוען..."}</p>
      </div>
    );
  }

  const businessProfile = safeBusinessProfile(organizationSettings);
  const kpis = businessProfile.dashboardKpis
    .filter((kpi) => !kpi.module || moduleIsEnabled(organizationSettings, kpi.module))
    .map((kpi) => ({
      label: kpi.label,
      value: formatDashboardMetric(kpi, stats),
      icon: dashboardMetricIcon(kpi.metric),
      detail: kpi.detail,
      tone: dashboardMetricTone(kpi.metric),
    }));
  const businessWidgets = businessProfile.dashboardWidgets.filter((widget) => moduleIsEnabled(organizationSettings, widget.module));
  const showSupplier = moduleIsEnabled(organizationSettings, "supplier_management");
  const showInvoices = moduleIsEnabled(organizationSettings, "invoices");
  const showTasks = moduleIsEnabled(organizationSettings, "tasks");
  const showCrm = moduleIsEnabled(organizationSettings, "crm");
  const showWhatsApp = moduleIsEnabled(organizationSettings, "whatsapp");
  const showDocuments = moduleIsEnabled(organizationSettings, "documents");
  const gmailConnected = Boolean(gmailStatus?.connected);
  const scanRangeLabel = `${scanRangeDays} ימים`;
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
              <div className="text-[12px] font-bold uppercase tracking-[0.22em] text-ink-muted">{businessProfile.title}</div>
              <div className="mt-1 text-sm text-ink-secondary">{businessTypeLabel(organizationSettings?.businessType)} · {enabledModuleCount(organizationSettings)} מודולים פעילים</div>
            </div>
          </div>
          <div>
            <h1>לוח בקרה</h1>
            <p>{businessProfile.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn" onClick={runSync} disabled={syncing}><ScanLine className="h-4 w-4" />{syncing ? "סורק..." : "סרוק ג׳ימייל"}</button>
          <button className="btn btn-secondary" onClick={scanAllClients} disabled={syncing}><RefreshCcw className="h-4 w-4" />סרוק לקוחות</button>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/clients")}><Plus className="h-4 w-4" />הוסף לקוח</button>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/business-settings")}>התאם מודולים</button>
        </div>
      </div>

      <section className="mb-4 rounded-2xl border border-[var(--border)] bg-surface-secondary p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2>הכנה לבדיקה עסקית ראשונה</h2>
            <p className="text-sm">חבר ג׳ימייל, בחר טווח סריקה, ואשר שהשמירה לדרייב ולשיטס פעילה.</p>
          </div>
          <span className={`badge ${gmailConnected ? "badge-ok" : "badge-warn"}`}>{gmailConnected ? "ג׳ימייל מחובר" : "ג׳ימייל לא מחובר"}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <OnboardingStep title="1. Gmail" done={gmailConnected} text={gmailConnected ? "מחובר ומוכן לסריקה" : "חובה לחבר לפני סריקה"} action={!gmailConnected ? <button className="btn btn-secondary" onClick={connectGmail}>התחבר ל-Gmail</button> : null} />
          <OnboardingStep title="2. טווח סריקה" done text={<select value={scanRangeDays} onChange={(e) => setScanRangeDays(Number(e.target.value))}><option value={7}>7 ימים</option><option value={30}>30 ימים</option><option value={90}>90 ימים</option></select>} />
          <OnboardingStep title="3. דרייב" done text="תיקיות נוצרות אוטומטית לפי ספק וסוג מסמך" />
          <OnboardingStep title="4. שיטס" done text="טבלת תשלומי ספקים נוצרת ומתעדכנת אוטומטית" />
          <OnboardingStep
            title="5. סריקה"
            done={Boolean(activeScan?.status === "completed" || scanStatus?.last?.status === "success")}
            text={activeScanId ? "סריקה רצה עכשיו" : `מוכן לסריקת ${scanRangeLabel}`}
            action={<button className="btn" onClick={startFirstScan} disabled={!gmailConnected || Boolean(activeScanId)}>{firstScanRunning ? "סורק..." : `התחל סריקת ${scanRangeLabel}`}</button>}
          />
        </div>
        {(firstScanRunning || scanProgress.length > 0 || firstScanSummary) && (
          <div className="mt-4 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <strong className="text-ink-primary">סטטוס סריקה ראשונית</strong>
              <span className="badge badge-warn">{scanRangeLabel}</span>
            </div>
            {firstScanSummary && <p className="text-sm">{firstScanSummary}</p>}
            {scanProgress.length > 0 && <div className="mt-3 grid gap-1 text-sm text-ink-secondary">{scanProgress.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>}
            {showGmailConnect && (
              <button type="button" onClick={connectGmail} className="btn mt-3">
                התחבר ל-Gmail
              </button>
            )}
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
      {actionMessage && <div className="toast border-emerald-400/30 text-emerald-200">{actionMessage}</div>}

      {(activeScan || activeScanId) && (
        <section className="mb-6 rounded-2xl border border-[#818CF8]/50 bg-[#818CF8]/10 p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2>סטטוס סריקה</h2>
              <p className="text-sm">מעקב חי אחרי עיבוד מיילים, קבצים, דרייב ושיטס.</p>
            </div>
            <span className={`badge ${activeScan?.status === "error" ? "badge-error" : activeScan?.status === "completed" ? "badge-ok" : "badge-warn"}`}>
              {activeScan?.status === "completed" ? "הושלם" : activeScan?.status === "error" ? "נכשל" : "סורק"}
            </span>
          </div>
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-sm font-semibold text-ink-secondary">
              <span>התקדמות</span>
              <span>{activeScan?.progressPercent ?? 0}%{activeScan?.estimatedRemainingSeconds ? ` · כ-${Math.ceil(activeScan.estimatedRemainingSeconds / 60)} דק׳` : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-[#818CF8] transition-all" style={{ width: `${activeScan?.progressPercent ?? 5}%` }} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-6">
            <MiniMetric label="מיילים" value={activeScan?.emailsFetched ?? 0} />
            <MiniMetric label="נשמרו" value={activeScan?.emailsSaved ?? 0} />
            <MiniMetric label="חשבוניות" value={activeScan?.invoicesFound ?? 0} />
            <MiniMetric label="תשלומי ספקים" value={activeScan?.supplierPaymentsFound ?? 0} />
            <MiniMetric label="דרייב" value={activeScan?.uploadedToDrive ?? 0} />
            <MiniMetric label="שיטס" value={activeScan?.sheetsUpdated ?? 0} />
            <MiniMetric label="נכשל/בדיקה" value={activeScan?.failedItems?.length ?? Object.values(activeScan?.rejectedReasons ?? {}).reduce((sum, count) => sum + count, 0)} />
          </div>
          {scanProgress.length > 0 && <div className="mt-3 grid gap-1 text-sm text-ink-secondary">{scanProgress.map((line) => <span key={line}>{line}</span>)}</div>}
          {activeScan?.lastSuccessfulScanAt && <div className="mt-3 text-sm text-ink-secondary">סריקה מוצלחת אחרונה: {new Date(activeScan.lastSuccessfulScanAt).toLocaleString("he-IL")}</div>}
          {activeScan?.finalSummary && (
            <div className="mt-3 rounded-xl bg-surface-secondary p-3 text-sm text-ink-secondary">
              סיכום סופי: {activeScan.finalSummary.emailsFetched} מיילים · {activeScan.finalSummary.invoicesFound} חשבוניות · {activeScan.finalSummary.paymentsFound} תשלומים · {activeScan.finalSummary.uploadedToDrive} דרייב · {activeScan.finalSummary.sheetsUpdated} שיטס
            </div>
          )}
          {Boolean(activeScan?.failedItems?.length) && (
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">
              <div className="font-semibold">פריטים שנכשלו / דורשים בדיקה</div>
              {activeScan?.failedItems?.slice(0, 5).map((item) => (
                <div key={item.id} className="mt-1">
                  {item.subject || item.sender} · {item.decisionReason}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="auto-grid mb-8">
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

      {businessWidgets.length > 0 && (
        <section className="mb-8 grid gap-4 md:grid-cols-3">
          {businessWidgets.map((widget) => (
            <div key={widget.id} className="card">
              <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.18em] text-ink-muted">{businessTypeLabel(organizationSettings?.businessType)}</div>
              <h2>{widget.title}</h2>
              <p className="text-sm">{widget.description}</p>
              <div className="mt-4 rounded-xl bg-surface-secondary p-3">
                <div className="stat-value">{formatDashboardMetric({ metric: widget.metric }, stats)}</div>
                <div className="stat-label">{businessModulesLabel(widget.module)}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="mb-8 grid gap-3 md:grid-cols-4">
        {showInvoices && <MiniMetric label="חשבוניות וקבלות" value={stats.totalInvoices} />}
        {showSupplier && <MiniMetric label="תשלומים פתוחים" value={stats.unpaidPayments} />}
        {showSupplier && <MiniMetric label="תשלומים ששולמו" value={stats.paidPayments} />}
        {showSupplier && <MiniMetric label="חשבוניות חסרות" value={stats.missingInvoicesCount} />}
        <MiniMetric label="סריקות שהושלמו" value={stats.scansCompleted} />
        {showDocuments && <MiniMetric label="העלאות לדרייב" value={stats.driveUploads} />}
        {showSupplier && <MiniMetric label="תשלומי ספקים" value={stats.supplierPaymentsCount} />}
        {showSupplier && <MiniMetric label="סכומים חשודים שסוננו" value={stats.suspiciousPaymentsCount} />}
      </section>

      <section className="mb-8 grid gap-6 xl:grid-cols-2">
        {showSupplier && <BusinessTable
          title="תשלומי ספקים"
          empty="אין תשלומי ספקים עדיין."
          rows={payments.slice(0, 8).map((payment) => ({
            id: payment.id,
            title: payment.supplier,
            meta: `${new Date(payment.date).toLocaleDateString("he-IL")} · ${formatCurrency(payment.amount, payment.currency)}`,
            badge: payment.paid ? "שולם" : payment.missingInvoice ? "חסרה חשבונית" : "פתוח",
            actions: (
              <div className="flex flex-wrap gap-2">
                {!payment.paid && <button className="btn btn-secondary px-3 py-1.5" onClick={() => markPaymentPaid(payment.id)}>סמן שולם</button>}
                {payment.missingInvoice && <button className="btn btn-secondary px-3 py-1.5" onClick={() => attachInvoiceToPayment(payment.id)}>צרף חשבונית</button>}
              </div>
            ),
          }))}
        />}
        {showSupplier && <BusinessTable
          title="חשבוניות חסרות"
          empty="אין חשבוניות חסרות."
          rows={missingInvoices.slice(0, 8).map((payment) => ({
            id: payment.id,
            title: payment.supplier,
            meta: `${payment.subject ?? "ללא נושא"} · ${new Date(payment.date).toLocaleDateString("he-IL")}`,
            badge: "דורש טיפול",
            actions: <button className="btn btn-secondary px-3 py-1.5" onClick={() => attachInvoiceToPayment(payment.id)}>צרף קישור</button>,
          }))}
        />}
        {showInvoices && <BusinessTable
          title="חשבוניות אחרונות"
          empty="אין חשבוניות שנשמרו."
          rows={recentInvoices.map((invoice) => ({
            id: invoice.id,
            title: invoice.client?.name ?? "לקוח לא ידוע",
            meta: `${new Date(invoice.date).toLocaleDateString("he-IL")} · ${formatCurrency(invoice.amount, invoice.currency)}`,
            badge: invoiceStatusLabel(invoice.status),
            actions: invoice.driveUrl ? <a className="btn btn-secondary px-3 py-1.5" href={invoice.driveUrl} target="_blank" rel="noreferrer">פתח בדרייב</a> : null,
          }))}
        />}
        {showTasks && <BusinessTable
          title="משימות אחרונות"
          empty="אין משימות פתוחות."
          rows={recentTasks.map((task) => ({
            id: task.id,
            title: task.title,
            meta: `${task.supplier ?? "כללי"} · ${taskPriorityLabel(task.priority)}`,
            badge: taskStatusLabel(task.status),
            actions: null,
          }))}
        />}
        <BusinessTable
          title="כשלים ותור בדיקה"
          empty="אין כשלים פתוחים."
          rows={alerts.map((alert) => ({
            id: alert.id,
            title: alert.title,
            meta: alert.body ?? new Date(alert.createdAt).toLocaleString("he-IL"),
            badge: alertTypeLabel(alert.type),
            actions: <button className="btn btn-secondary px-3 py-1.5" onClick={runSync}>נסה סריקה מחדש</button>,
          }))}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        {showCrm && <div className="card">
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
            {clients?.clients.length === 0 && (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
                <h3 className="text-base font-semibold text-ink-primary">עדיין אין לקוחות</h3>
                <p className="mt-1 text-sm">הוסף לקוח ראשון כדי לראות כאן פעילות, חשבוניות ומשימות.</p>
              </div>
            )}
          </div>
        </div>}

        <div className="space-y-6">
          <div className="card">
            <div className="mb-4 flex items-center gap-3">
              <Clock3 className="h-5 w-5 text-accent-primary" />
              <h2>סטטוס אוטומציה</h2>
            </div>
            <div className="space-y-3 text-sm text-ink-secondary">
              <div className="flex justify-between"><span>מצב חי</span><span className="text-emerald-300">פעיל</span></div>
              <div className="flex justify-between"><span>עודכן לאחרונה</span><span>{lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען..."}</span></div>
              <div className="flex justify-between"><span>סריקה הבאה</span><span>{scanStatus ? new Date(scanStatus.nextScheduledScanAt).toLocaleString("he-IL") : "טוען..."}</span></div>
              {scanStatus?.last && (
                <div className="rounded-xl bg-surface-hover p-3">
                  <div className="font-semibold text-ink-primary">סריקה אחרונה: {scanStatusLabel(scanStatus.last.status)}</div>
                  <div>מיילים {scanStatus.last.found} · נשמרו {scanStatus.last.saved}</div>
                  <div>חשבוניות {scanStatus.last.invoicesFound ?? 0} · תשלומים {scanStatus.last.paymentsFound ?? 0}</div>
                  <div>דרייב {scanStatus.last.driveUploaded ?? 0} · שיטס {scanStatus.last.sheetsUpdated ?? 0}</div>
                  {scanStatus.last.errors && <div className="text-red-200">{scanStatus.last.errors}</div>}
                </div>
              )}
            </div>
          </div>
          {showWhatsApp && <div className="card">
            <div className="mb-4 flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-emerald-300" />
              <h2>וואטסאפ</h2>
            </div>
            <div className="stat-value">{whatsAppStats?.sentToday ?? 0}</div>
            <p>הודעות נשלחו היום · {whatsAppStats?.activeChats ?? 0} שיחות פעילות</p>
            <button className="btn btn-secondary mt-4" onClick={() => router.push("/dashboard/whatsapp")}>פתח מרכז וואטסאפ</button>
          </div>}
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
        <div className="card">
          <h2>פעולות מהירות</h2>
          <div className="mt-4 grid gap-3">
            <button className="btn btn-secondary" onClick={() => router.push("/dashboard/settings")}>פתח הגדרות אינטגרציות</button>
            <button className="btn btn-secondary" onClick={() => router.push("/camera")}><FileText className="h-4 w-4" />צלם/העלה חשבונית</button>
          </div>
        </div>
        <div className="card">
          <h2>סיכום יומי</h2>
          <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-ink-secondary">{summary}</pre>
        </div>
      </section>
      {invoiceAttachPaymentId && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="attach-invoice-title" onClick={() => setInvoiceAttachPaymentId(null)}>
          <form className="card w-full max-w-lg" onSubmit={submitInvoiceAttachment} onClick={(event) => event.stopPropagation()}>
            <h2 id="attach-invoice-title">צירוף חשבונית לתשלום</h2>
            <p className="mt-2 text-sm">הדבק קישור לחשבונית בדרייב כדי לסגור את החוסר בתשלום הספק.</p>
            <label className="mt-4">
              קישור לחשבונית
              <input dir="ltr" value={invoiceAttachLink} onChange={(event) => setInvoiceAttachLink(event.target.value)} placeholder="https://drive.google.com/..." autoFocus />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn" type="submit" disabled={!invoiceAttachLink.trim()}>צרף חשבונית</button>
              <button className="btn btn-secondary" type="button" onClick={() => setInvoiceAttachPaymentId(null)}>ביטול</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function relativeTime(date: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes === 0) return "עכשיו";
  if (minutes === 1) return "לפני דקה";
  return `לפני ${minutes} דקות`;
}

function safeBusinessProfile(settings: OrganizationSettings | null) {
  return getBusinessProfile(settings?.businessType);
}

function enabledModuleCount(settings: OrganizationSettings | null) {
  return settings ? normalizeEnabledModules(settings.enabledModules, settings.businessType).length : 7;
}

function moduleIsEnabled(settings: OrganizationSettings | null, moduleId: BusinessModuleId) {
  return !settings || normalizeEnabledModules(settings.enabledModules, settings.businessType).includes(moduleId);
}

function dashboardMetricValue(metric: DashboardKpiMetric, stats: DashboardStats) {
  const values: Record<DashboardKpiMetric, number> = {
    clients: stats.clients,
    moneyToReceive: stats.moneyToReceive,
    moneyToPay: stats.moneyToPay,
    openTasks: stats.openTasks,
    businessHealthScore: stats.businessHealthScore,
    totalInvoices: stats.totalInvoices,
    unpaidPayments: stats.unpaidPayments,
    supplierPaymentsCount: stats.supplierPaymentsCount,
  };
  return values[metric] ?? 0;
}

function formatDashboardMetric(kpi: Pick<BusinessKpiConfig, "metric" | "format">, stats: DashboardStats) {
  const value = dashboardMetricValue(kpi.metric, stats);
  if (kpi.format === "currency") return `₪${value.toLocaleString("he-IL")}`;
  if (kpi.format === "score") return `${value}/100`;
  return value.toLocaleString("he-IL");
}

function dashboardMetricIcon(metric: DashboardKpiMetric) {
  if (metric === "moneyToReceive") return ArrowUpRight;
  if (metric === "moneyToPay" || metric === "supplierPaymentsCount" || metric === "unpaidPayments") return WalletCards;
  if (metric === "openTasks") return Clock3;
  if (metric === "businessHealthScore") return HeartPulse;
  return Activity;
}

function dashboardMetricTone(metric: DashboardKpiMetric) {
  if (metric === "moneyToReceive") return "text-emerald-300";
  if (metric === "moneyToPay" || metric === "supplierPaymentsCount" || metric === "unpaidPayments") return "text-amber-300";
  if (metric === "openTasks") return "text-violet-300";
  if (metric === "businessHealthScore") return "text-blue-300";
  return "text-blue-300";
}

function businessModulesLabel(moduleId: string) {
  return businessModules.find((module) => module.id === moduleId)?.label ?? moduleId;
}

function scanStatusLabel(status: string) {
  return uiTranslations.statuses[status as keyof typeof uiTranslations.statuses] ?? status;
}

function taskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "פתוח",
    todo: "לביצוע",
    "in-progress": "בתהליך",
    done: "בוצע",
    completed: "בוצע",
  };
  return labels[status] ?? scanStatusLabel(status);
}

function taskPriorityLabel(priority: string) {
  const labels: Record<string, string> = { low: "עדיפות נמוכה", medium: "עדיפות בינונית", high: "עדיפות גבוהה" };
  return labels[priority] ?? priority;
}

function invoiceStatusLabel(status: string) {
  const labels: Record<string, string> = { paid: "שולם", pending: "ממתין", overdue: "באיחור", draft: "טיוטה" };
  return labels[status] ?? scanStatusLabel(status);
}

function alertTypeLabel(type: string) {
  const labels: Record<string, string> = { error: "שגיאה", warning: "אזהרה", info: "מידע", review: "לבדיקה" };
  return labels[type] ?? type;
}

function formatCurrency(amount: number, currency: string) {
  const symbols: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  return `${symbols[currency] ?? currency} ${amount.toLocaleString("he-IL")}`;
}

function OnboardingStep({ title, done, text, action }: { title: string; done: boolean; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-ink-primary">{title}</strong>
        <span className={`badge ${done ? "badge-ok" : "badge-warn"}`}>{done ? "מוכן" : "נדרש"}</span>
      </div>
      <div className="text-sm text-ink-secondary">{text}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-surface-secondary p-3">
      <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink-primary">{value}</div>
    </div>
  );
}

function BusinessTable({
  title,
  rows,
  empty,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; title: string; meta: string; badge: string; actions: ReactNode }>;
}) {
  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2>{title}</h2>
        <span className="badge">{rows.length}</span>
      </div>
      <div className="grid gap-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary/70 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <strong className="block truncate text-ink-primary">{row.title}</strong>
                <p className="mt-1 break-words text-sm text-ink-secondary">{row.meta}</p>
              </div>
              <span className="badge w-fit shrink-0">{row.badge}</span>
            </div>
            {row.actions && <div className="mt-3">{row.actions}</div>}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
            <p className="text-sm">{empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function scanProgressMessages(progress: ScanProgressResult) {
  return [
    progress.status === "running" ? "סורק ומעבד מיילים..." : progress.status === "completed" ? "הסריקה הושלמה" : "הסריקה נכשלה",
    `התקדמות ${progress.progressPercent ?? 0}%${progress.estimatedRemainingSeconds ? ` · נותרו בערך ${Math.ceil(progress.estimatedRemainingSeconds / 60)} דק׳` : ""}`,
    `נמצאו ${progress.emailsFetched} מיילים`,
    `נשמרו ${progress.emailsSaved} פריטי סריקה`,
    `נמצאו ${progress.invoicesFound} חשבוניות ו-${progress.supplierPaymentsFound} תשלומי ספקים`,
    `הועלו ${progress.uploadedToDrive} קבצים לדרייב ועודכנו ${progress.sheetsUpdated ?? 0} שורות שיטס`,
    `נכשלו/דורשים בדיקה: ${progress.failedItems?.length ?? Object.values(progress.rejectedReasons ?? {}).reduce((sum, count) => sum + count, 0)}`,
  ];
}

function formatProgressSummary(progress: ScanProgressResult) {
  return `נמצאו ${progress.emailsFetched} מיילים · נשמרו ${progress.emailsSaved} · חשבוניות ${progress.invoicesFound} · תשלומי ספקים ${progress.supplierPaymentsFound} · דרייב ${progress.uploadedToDrive} · שיטס ${progress.sheetsUpdated ?? 0}`;
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
  return `נבדקו ${summary.totalEmailsChecked ?? summary.emailsScanned} מיילים · נמצאו ${summary.relevantEmailsFound ?? summary.invoiceOrPaymentEmailsFound} רלוונטיים · נשמרו ${summary.recordsSaved} רשומות · לבדיקה ${summary.needsReviewCount ?? 0} · שגיאות ${summary.errorsCount ?? 0}`;
}
