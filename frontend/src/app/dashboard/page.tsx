"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScanBanner } from "@/components/ui/ScanBanner";
import { StatusPill } from "@/components/ui/StatusPill";
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
import { colors, radius, shadow, spacing, type as typography } from "@/lib/design-tokens";
import { labelFor } from "@/lib/labels";
import type { OrganizationSettings } from "@/lib/business-config";

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
    windowTruncated?: boolean;
    totalMatched?: number | null;
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
    windowTruncated?: boolean;
    totalMatched?: number | null;
    startedAt: string;
    endedAt: string | null;
  } | null;
  nextScheduledScanAt: string;
};

type WhatsAppAssistantStats = {
  sentToday: number;
  activeChats: number;
};

type SystemComponentStatus = {
  name: "gmail" | "drive" | "sheets" | "whatsapp" | "database";
  label: string;
  connected: boolean;
  status: "PASS" | "FAIL";
  reason: string | null;
  details?: Record<string, unknown>;
};

type SystemHealth = {
  checkedAt: string;
  allPassed: boolean;
  components: Record<SystemComponentStatus["name"], SystemComponentStatus>;
};

type WhatsAppScanResult = {
  scanId: string | null;
  status: "disabled" | "started" | "running" | "completed" | "error";
  inProgress?: boolean;
  mode: string;
  progressUrl?: string;
  progressPercent?: number;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
  messagesFound: number;
  messagesScanned: number;
  mediaMessagesFound?: number;
  mediaItemsFound?: number;
  mediaItemsProcessed?: number;
  driveFilesCreated?: number;
  supplierPaymentsCreatedOrUpdated?: number;
  invoiceRecordsCreatedOrUpdated?: number;
  paymentMessagesFound: number;
  supplierPaymentsFound: number;
  errorsCount: number;
  errors: string[];
};

type ScanToast = {
  type: "info" | "success" | "warning" | "error";
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
  windowTruncated?: boolean;
  totalMatched?: number | null;
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
  status: "running" | "completed" | "partial" | "error";
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
    windowTruncated?: boolean;
    totalMatched?: number | null;
    completedAt: string;
  } | null;
  lastSuccessfulScanAt?: string | null;
  rejectedReasons: Record<string, number>;
  progressPercent?: number;
  estimatedRemainingSeconds?: number | null;
  summary?: GmailScanSummary;
  windowTruncated?: boolean;
  totalMatched?: number | null;
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

type DocumentReview = {
  id: string;
  source: string;
  sender: string | null;
  subject: string | null;
  fileName: string | null;
  documentType: string;
  supplierName: string | null;
  totalAmount: number | null;
  confidenceScore: number;
  uncertaintyReason: string | null;
  driveFileUrl: string | null;
  reviewStatus: string;
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
  documentsInDrive: 0,
  invoicesFromGmail: 0,
  invoicesFromWhatsApp: 0,
  clients: 0,
  suspiciousPaymentsCount: 0,
  sheetsReconciliation: null,
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
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [systemChecking, setSystemChecking] = useState(false);
  const [showSystemCheck, setShowSystemCheck] = useState(false);
  const [whatsAppScanRange, setWhatsAppScanRange] = useState("30");
  const [whatsAppScanning, setWhatsAppScanning] = useState(false);
  const [whatsAppScanResult, setWhatsAppScanResult] = useState<WhatsAppScanResult | null>(null);
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
  const [documentReviews, setDocumentReviews] = useState<DocumentReview[]>([]);
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
      const [statsResult, summaryResult, gmailResult, clientsResult, scanStatusResult, paymentsResult, missingResult, invoicesResult, tasksResult, alertsResult, orgResult, systemResult, reviewsResult] = await Promise.allSettled([
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
        apiFetch<SystemHealth>("/api/system/health", { timeoutMs: 30000 }),
        apiFetch<DocumentReview[]>("/api/document-reviews?status=needs_review"),
      ]);

      setStats(statsResult.status === "fulfilled" ? statsResult.value : emptyStats);
      setSummary(summaryResult.status === "fulfilled" ? summaryResult.value.text : "לא ניתן לטעון סיכום כרגע.");
      setGmailStatus(gmailResult.status === "fulfilled" ? gmailResult.value : { googleConfigured: true, connected: false, connectedAt: null });
      setClients(clientsResult.status === "fulfilled" ? clientsResult.value : emptyClients);

      if (scanStatusResult.status === "fulfilled") {
        setScanStatus(scanStatusResult.value);
        const running = scanStatusResult.value.logs.find((log) => log.status === "running" && !log.endedAt);
        if (running && !activeScanId) {
          setActiveScanId(running.id);
          window.localStorage.setItem("activeGmailScanId", running.id);
        }
      } else {
        setScanStatus(emptyScanStatus());
      }

      setPayments(paymentsResult.status === "fulfilled" ? paymentsResult.value : []);
      setMissingInvoices(missingResult.status === "fulfilled" ? missingResult.value : []);
      setRecentInvoices(invoicesResult.status === "fulfilled" ? invoicesResult.value.invoices : []);
      setRecentTasks(tasksResult.status === "fulfilled" ? tasksResult.value.slice(0, 8) : []);
      setAlerts(alertsResult.status === "fulfilled" ? alertsResult.value.slice(0, 8) : []);
      setDocumentReviews(reviewsResult.status === "fulfilled" ? reviewsResult.value.slice(0, 5) : []);

      if (orgResult.status === "fulfilled") {
        setOrganizationSettings(orgResult.value);
        if (orgResult.value.onboardingRequired) {
          router.replace("/onboarding");
          return;
        }
      }

      setSystemHealth(systemResult.status === "fulfilled" ? systemResult.value : null);
      apiFetch<WhatsAppAssistantStats>("/api/whatsapp-assistant/stats").then(setWhatsAppStats).catch(() => undefined);
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
  }, [activeScanId, router]);

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
        if (progress.status === "completed" || progress.status === "partial") {
          setFirstScanRunning(false);
          setSyncing(false);
          setFirstScanSummary(formatProgressSummary(progress));
          setScanToast({
            type: progress.status === "partial" ? "warning" : "success",
            text: progress.status === "partial" ? formatPartialScanMessage(progress) : "הסריקה הסתיימה והנתונים עודכנו",
          });
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
      const result = await apiFetch<GmailScanResult>("/api/gmail/scan", { method: "POST", body: JSON.stringify({ daysBack: scanRangeDays }) });
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
      if (!data.url) throw new Error("שרת לא החזיר כתובת חיבור לגוגל");
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
        const message = result.inProgress ? "סריקת המיילים מתבצעת כעת..." : "סריקת ג׳ימייל התחילה ברקע.";
        setError(message);
        setScanToast({ type: "info", text: message });
        return;
      }
      await load();
      const summary = scanSummaryFromResult(result);
      const message = result.message ?? (result.backgroundProcessing ? `נמצאו ${summary.emailsScanned} מיילים בג׳ימייל. העיבוד המלא ממשיך ברקע ויעדכן חשבוניות/תשלומים.` : formatScanSuccess(summary));
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
      const result = await apiFetch<{ success: boolean; results?: Array<{ message?: string }> }>("/api/clients/scan-all", { method: "POST" });
      await load();
      setError(result.results?.find((item) => item.message)?.message ?? "סריקת כל הלקוחות הסתיימה");
    } catch (e) {
      setError(e instanceof Error ? e.message : "סריקת לקוחות נכשלה");
    } finally {
      setSyncing(false);
    }
  }

  async function runSystemCheck() {
    setSystemChecking(true);
    setShowSystemCheck(true);
    setError("");
    try {
      const result = await apiFetch<SystemHealth>("/api/system/health/check", { method: "POST", timeoutMs: 45000 });
      setSystemHealth(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "בדיקת מערכת נכשלה");
    } finally {
      setSystemChecking(false);
    }
  }

  async function runWhatsAppScan() {
    setWhatsAppScanning(true);
    setWhatsAppScanResult(null);
    setError("");
    const fullScan = whatsAppScanRange === "full";
    try {
      const result = await apiFetch<WhatsAppScanResult>("/api/whatsapp/scan", {
        method: "POST",
        timeoutMs: 15000,
        body: JSON.stringify({ fullScan, daysBack: fullScan ? null : Number(whatsAppScanRange) }),
      });
      setWhatsAppScanResult(result);
      if (result.progressUrl && result.inProgress) {
        setScanToast({ type: "info", text: "סריקת וואטסאפ התחילה ברקע. מעבד קבצים וחשבוניות..." });
        const completed = await pollWhatsAppScan(result.progressUrl);
        setWhatsAppScanResult(completed);
        setScanToast({
          type: completed.status === "completed" ? "success" : "error",
          text: completed.status === "completed"
            ? `סריקת וואטסאפ הסתיימה: ${completed.messagesScanned} הודעות · ${completed.supplierPaymentsFound} תשלומי ספקים`
            : `סריקת וואטסאפ נכשלה: ${completed.error ?? completed.errors?.[0] ?? "שגיאה לא ידועה"}`,
        });
        await load();
        return;
      }
      setScanToast({
        type: result.status === "completed" ? "success" : "error",
        text: result.status === "completed" ? `סריקת וואטסאפ הסתיימה: ${result.messagesScanned} הודעות נסרקו` : `סריקת וואטסאפ הסתיימה עם ${result.errorsCount} שגיאות`,
      });
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "סריקת וואטסאפ נכשלה";
      setError(message);
      setScanToast({ type: "error", text: message });
    } finally {
      setWhatsAppScanning(false);
    }
  }

  async function pollWhatsAppScan(progressUrl: string) {
    let latest = await apiFetch<WhatsAppScanResult>(progressUrl, { timeoutMs: 15000 });
    setWhatsAppScanResult(latest);
    for (let attempt = 0; latest.inProgress && attempt < 120; attempt += 1) {
      await delay(2500);
      latest = await apiFetch<WhatsAppScanResult>(progressUrl, { timeoutMs: 15000 });
      setWhatsAppScanResult(latest);
    }
    return latest;
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

  function attachInvoiceToPayment(paymentId: string) {
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

  const gmailConnected = Boolean(gmailStatus?.connected);
  const whatsAppConnected = Boolean(systemHealth?.components.whatsapp.connected);
  const todayGreeting = greetingForNow();
  const scanBanner = buildScanBannerState(activeScan, scanStatus);
  const monthInvoices = recentInvoices.filter((invoice) => isThisMonth(invoice.date));
  const unpaidSupplierTotal = payments.filter((payment) => !payment.paid).reduce((sum, payment) => sum + payment.amount, 0);
  const paidThisMonth = payments.filter((payment) => payment.paid && isThisMonth(payment.date)).reduce((sum, payment) => sum + payment.amount, 0);
  const monthDocumentTotal = [
    ...payments.filter((payment) => isThisMonth(payment.date)).map((payment) => payment.amount),
    ...monthInvoices.map((invoice) => invoice.amount),
  ].reduce((sum, amount) => sum + amount, 0);
  const estimatedVat = monthDocumentTotal * 0.18 / 1.18;

  return (
    <main className={`${spacing.page} min-h-screen`} style={{ backgroundColor: colors.bg, color: colors.textPrimary }}>
      <Nav />
      <PageHeader
        title={`${todayGreeting} 👋`}
        subtitle="נטלי כאן — זה מה שקורה בעסק שלך עכשיו"
        action={
          <button
            type="button"
            onClick={runSync}
            disabled={syncing || Boolean(activeScanId)}
            className={`${radius.control} min-h-11 px-5 py-3 font-semibold disabled:opacity-60`}
            style={{ backgroundColor: colors.accent, color: colors.surface, border: `1px solid ${colors.accent}` }}
          >
            {syncing || activeScanId ? "סורקת..." : "סרוק עכשיו"}
          </button>
        }
      />

      <div className={`grid ${spacing.section}`}>
        {scanBanner && (
          <ScanBanner
            status={scanBanner.status}
            found={scanBanner.found}
            scanned={scanBanner.scanned}
            totalMatched={scanBanner.totalMatched}
            errors={scanBanner.errors}
          />
        )}

        <MessageStack error={error} actionMessage={actionMessage} toast={scanToast} />

        {showGmailConnect && (
          <section className={`${radius.card} ${shadow.card} ${spacing.card}`} style={{ backgroundColor: colors.surface, border: `1px solid ${colors.warnBorder}` }}>
            <div className={typography.sectionTitle} style={{ color: colors.textPrimary }}>צריך לחבר ג׳ימייל</div>
            <p className={`${typography.body} mt-2`} style={{ color: colors.textSecondary }}>חיבור ג׳ימייל נדרש לפני סריקת המסמכים.</p>
            <button type="button" onClick={connectGmail} className={`${radius.control} mt-4 min-h-11 px-4 py-3 font-semibold`} style={{ backgroundColor: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent }}>
              התחבר לג׳ימייל
            </button>
          </section>
        )}

        <section className={`grid ${spacing.section}`}>
          <SectionTitle title="ממתינים לאישורך" />
          {documentReviews.length > 0 ? (
            <div className={`grid ${spacing.inline}`}>
              {documentReviews.map((item) => (
                <ReviewRow key={item.id} item={item} />
              ))}
              <a href="/dashboard/document-reviews" className={`${typography.body} font-semibold`} style={{ color: colors.accent }}>
                לכל המסמכים לבדיקה ←
              </a>
            </div>
          ) : (
            <EmptyState title="הכל מאושר ✓" hint="אין מסמכים שממתינים לבדיקה שלך" />
          )}
        </section>

        <section className={`grid grid-cols-2 md:grid-cols-4 ${spacing.inline}`}>
          <KpiCard title="חשבוניות החודש" value={stats ? formatNumber(monthInvoices.length) : "—"} subtitle="מסמכים שנמצאו החודש" />
          <KpiCard title="ממתין לתשלום" value={stats ? formatShekel(unpaidSupplierTotal) : "—"} subtitle="תשלומי ספקים פתוחים" />
          <KpiCard title="שולם החודש" value={stats ? formatShekel(paidThisMonth) : "—"} subtitle="לפי תאריך המסמך" />
          <KpiCard title="מע״מ משוער" value={stats ? formatShekel(estimatedVat) : "—"} subtitle="הערכה לפי 18% מע״מ" />
        </section>

        <section className={`grid ${spacing.section} lg:grid-cols-2`}>
          <ActivityCard title="תשלומי ספקים" empty="אין תשלומי ספקים עדיין">
            {payments.slice(0, 5).map((payment) => (
              <DataRow
                key={payment.id}
                title={payment.supplier || "ספק לא ידוע"}
                meta={`${formatDate(payment.date)} · ${formatShekel(payment.amount)}`}
                pill={<StatusPill tone={payment.paid ? "success" : "warn"}>{labelFor("paymentStatus", payment.paid ? "paid" : "pending")}</StatusPill>}
                action={!payment.paid ? <SecondaryButton onClick={() => markPaymentPaid(payment.id)}>סמן שולם</SecondaryButton> : null}
              />
            ))}
          </ActivityCard>

          <ActivityCard title="חשבוניות חסרות" empty="אין חשבוניות חסרות">
            {missingInvoices.slice(0, 5).map((payment) => (
              <DataRow
                key={payment.id}
                title={payment.supplier || "ספק לא ידוע"}
                meta={`${payment.subject ?? "ללא נושא"} · ${formatDate(payment.date)}`}
                pill={<StatusPill tone="warn">{labelFor("paymentStatus", "missing_invoice")}</StatusPill>}
                action={<SecondaryButton onClick={() => attachInvoiceToPayment(payment.id)}>צרף קישור</SecondaryButton>}
              />
            ))}
          </ActivityCard>

          <ActivityCard title="חשבוניות אחרונות" empty="אין חשבוניות שנשמרו">
            {recentInvoices.slice(0, 5).map((invoice) => (
              <DataRow
                key={invoice.id}
                title={invoice.client?.name ?? "לקוח לא ידוע"}
                meta={`${formatDate(invoice.date)} · ${formatShekel(invoice.amount)}`}
                pill={<StatusPill tone={invoice.status === "paid" ? "success" : "warn"}>{labelFor("paymentStatus", invoice.status)}</StatusPill>}
                action={invoice.driveUrl ? <SecondaryLink href={invoice.driveUrl}>פתח בדרייב</SecondaryLink> : null}
              />
            ))}
          </ActivityCard>

          <ActivityCard title="משימות אחרונות" empty="אין משימות פתוחות">
            {recentTasks.slice(0, 5).map((task) => (
              <DataRow
                key={task.id}
                title={task.title}
                meta={`${task.supplier ?? "כללי"} · ${taskPriorityLabel(task.priority)}`}
                pill={<StatusPill tone={task.status === "completed" || task.status === "done" ? "success" : "info"}>{labelFor("scanStatus", task.status)}</StatusPill>}
              />
            ))}
          </ActivityCard>
        </section>

        <section className={`grid ${spacing.section} lg:grid-cols-2`}>
          <ActivityCard title="כשלים ותור בדיקה" empty="אין כשלים פתוחים">
            {alerts.slice(0, 5).map((alert) => (
              <DataRow
                key={alert.id}
                title={alert.title}
                meta={alert.body ?? formatDateTime(alert.createdAt)}
                pill={<StatusPill tone={alert.type === "error" ? "danger" : "warn"}>{alertTypeLabel(alert.type)}</StatusPill>}
                action={<SecondaryButton onClick={runSync}>נסה שוב</SecondaryButton>}
              />
            ))}
          </ActivityCard>

          <ActivityCard title="לקוחות אחרונים" empty="עדיין אין לקוחות">
            {(clients?.clients ?? []).slice(0, 5).map((client) => (
              <DataRow
                key={client.id}
                title={client.name}
                meta={`${formatShekel(client.stats?.toPay ?? 0)} לתשלום · ${client.stats?.invoices ?? 0} חשבוניות`}
                pill={<StatusPill tone={client.stats?.missingInvoices ? "warn" : "success"}>{client.stats?.missingInvoices ? `${client.stats.missingInvoices} חסרות` : "תקין"}</StatusPill>}
              />
            ))}
          </ActivityCard>
        </section>

        <section className={`grid ${spacing.section} lg:grid-cols-2`}>
          <SystemCard
            gmailConnected={gmailConnected}
            whatsAppConnected={whatsAppConnected}
            systemHealth={systemHealth}
            systemChecking={systemChecking}
            showSystemCheck={showSystemCheck}
            onConnectGmail={connectGmail}
            onConnectWhatsApp={() => router.push("/dashboard/whatsapp")}
            onRunSystemCheck={runSystemCheck}
          />

          <WhatsAppCard
            whatsAppConnected={whatsAppConnected}
            whatsAppScanning={whatsAppScanning}
            whatsAppScanRange={whatsAppScanRange}
            whatsAppScanResult={whatsAppScanResult}
            whatsAppStats={whatsAppStats}
            onRangeChange={setWhatsAppScanRange}
            onRun={runWhatsAppScan}
            onOpen={() => router.push("/dashboard/whatsapp")}
          />
        </section>

        <section className={`grid ${spacing.section} lg:grid-cols-2`}>
          <ActivityCard title="אוטומציה וסריקות" empty="אין נתוני סריקה עדיין">
            <DataRow title="עודכן לאחרונה" meta={lastUpdatedAt ? relativeTime(lastUpdatedAt) : "טוען"} pill={<StatusPill tone="info">פעיל</StatusPill>} />
            <DataRow title="סריקה הבאה" meta={scanStatus ? formatDateTime(scanStatus.nextScheduledScanAt) : "טוען"} />
            {scanStatus?.last && (
              <DataRow
                title="סריקה אחרונה"
                meta={`מיילים ${formatNumber(scanStatus.last.found)} · נשמרו ${formatNumber(scanStatus.last.saved)}`}
                pill={<StatusPill tone={scanStatus.last.status === "success" ? "success" : scanStatus.last.status === "partial" ? "warn" : "danger"}>{labelFor("scanStatus", scanStatus.last.status)}</StatusPill>}
                action={<SecondaryButton onClick={() => router.push("/dashboard/scan-stats")}>סטטיסטיקות</SecondaryButton>}
              />
            )}
          </ActivityCard>

          <ActivityCard title="סיכום יומי" empty="אין סיכום זמין">
            <p className={`${typography.body} whitespace-pre-wrap leading-7`} style={{ color: colors.textSecondary }}>{summary}</p>
            <div className="flex flex-wrap gap-3">
              <SecondaryButton onClick={scanAllClients} disabled={syncing}>סרוק לקוחות</SecondaryButton>
              <SecondaryButton onClick={() => router.push("/camera")}>צלם חשבונית</SecondaryButton>
              <SecondaryButton onClick={() => router.push("/dashboard/settings")}>הגדרות</SecondaryButton>
            </div>
          </ActivityCard>
        </section>
      </div>

      {invoiceAttachPaymentId && (
        <div className={`fixed inset-0 z-50 grid place-items-center ${spacing.page}`} style={{ backgroundColor: colors.bg }}>
          <form className={`${radius.card} ${shadow.raised} ${spacing.card} w-full max-w-lg`} style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }} onSubmit={submitInvoiceAttachment}>
            <h2 className={typography.sectionTitle}>צירוף חשבונית לתשלום</h2>
            <p className={`${typography.body} mt-2`} style={{ color: colors.textSecondary }}>הדבק קישור לחשבונית בדרייב כדי לסגור את החוסר בתשלום הספק.</p>
            <label className="mt-4">
              קישור לחשבונית
              <input dir="ltr" value={invoiceAttachLink} onChange={(event) => setInvoiceAttachLink(event.target.value)} placeholder="https://drive.google.com/..." autoFocus />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className={`${radius.control} min-h-11 px-4 py-3 font-semibold`} style={{ backgroundColor: colors.accent, border: `1px solid ${colors.accent}`, color: colors.surface }} type="submit" disabled={!invoiceAttachLink.trim()}>צרף חשבונית</button>
              <SecondaryButton type="button" onClick={() => setInvoiceAttachPaymentId(null)}>ביטול</SecondaryButton>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className={typography.sectionTitle} style={{ color: colors.textPrimary }}>{title}</h2>;
}

function ReviewRow({ item }: { item: DocumentReview }) {
  const title = reviewTitle(item);
  const description = reviewDescription(item);
  return (
    <article className={`${radius.card} ${shadow.card} ${spacing.card}`} style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }}>
      <div className="grid gap-3 sm:grid-cols-4 sm:items-center">
        <div className="sm:col-span-2">
          <div className={`${typography.body} font-semibold`} style={{ color: colors.textPrimary }}>{title}</div>
          <div className={`${typography.meta} mt-1`} style={{ color: colors.textPrimary }}>{description}</div>
        </div>
        <div className={typography.body} style={{ color: colors.textPrimary }}>
          {formatShekel(item.totalAmount ?? 0)} · {formatDate(item.createdAt)}
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <StatusPill tone="warn">{labelFor("reviewStatus", item.reviewStatus)}</StatusPill>
          <SecondaryLink href="/dashboard/document-reviews">צפה</SecondaryLink>
        </div>
      </div>
    </article>
  );
}

function reviewTitle(item: DocumentReview) {
  return item.supplierName?.trim() || item.sender?.trim() || sourceLabel(item.source) || "ספק לא ידוע";
}

function reviewDescription(item: DocumentReview) {
  return item.subject?.trim() || item.fileName?.trim() || item.uncertaintyReason?.trim() || labelFor("documentType", item.documentType) || "מסמך לבדיקה";
}

function sourceLabel(source: string) {
  return source === "whatsapp" ? "וואטסאפ" : source === "gmail" ? "ג׳ימייל" : source.replace(/_/g, " ");
}

function ActivityCard({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Boolean(children) && (!Array.isArray(children) || children.length > 0);
  return (
    <section className={`${radius.card} ${shadow.card} ${spacing.card}`} style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }}>
      <h2 className={typography.sectionTitle} style={{ color: colors.textPrimary }}>{title}</h2>
      <div className={`mt-4 grid ${spacing.inline}`}>
        {hasChildren ? children : <EmptyState title={empty} />}
      </div>
    </section>
  );
}

function DataRow({ title, meta, pill, action }: { title: ReactNode; meta: ReactNode; pill?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${radius.control} flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between`} style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}>
      <div className="min-w-0 flex-1">
        <div className={`${typography.body} truncate font-semibold`} style={{ color: colors.textPrimary }}>{title}</div>
        <div className={`${typography.meta} mt-1`} style={{ color: colors.textSecondary }}>{meta}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pill}
        {action}
      </div>
    </div>
  );
}

function MessageStack({ error, actionMessage, toast }: { error: string; actionMessage: string; toast: ScanToast | null }) {
  return (
    <div className="grid gap-3">
      {error && <InlineMessage tone="danger">{error}</InlineMessage>}
      {actionMessage && <InlineMessage tone="success">{actionMessage}</InlineMessage>}
      {toast && <InlineMessage tone={toast.type === "warning" ? "warn" : toast.type === "error" ? "danger" : toast.type}>{toast.text}</InlineMessage>}
    </div>
  );
}

function InlineMessage({ tone, children }: { tone: "info" | "success" | "warn" | "danger"; children: ReactNode }) {
  const style = tone === "success"
    ? { color: colors.successText, backgroundColor: colors.successBg, borderColor: colors.successBorder }
    : tone === "warn"
      ? { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder }
      : tone === "danger"
        ? { color: colors.dangerText, backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder }
        : { color: colors.infoText, backgroundColor: colors.infoBg, borderColor: colors.infoBorder };
  return <div className={`${radius.card} ${spacing.card} border ${typography.body} font-semibold`} style={style}>{children}</div>;
}

function SecondaryButton({ children, onClick, disabled, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${radius.control} min-h-11 px-4 py-3 font-semibold disabled:opacity-60`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent }}
    >
      {children}
    </button>
  );
}

function SecondaryLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      href={href}
      className={`${radius.control} inline-flex min-h-11 items-center justify-center px-4 py-3 font-semibold`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent }}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

function SystemCard({
  gmailConnected,
  whatsAppConnected,
  systemHealth,
  systemChecking,
  showSystemCheck,
  onConnectGmail,
  onConnectWhatsApp,
  onRunSystemCheck,
}: {
  gmailConnected: boolean;
  whatsAppConnected: boolean;
  systemHealth: SystemHealth | null;
  systemChecking: boolean;
  showSystemCheck: boolean;
  onConnectGmail: () => void;
  onConnectWhatsApp: () => void;
  onRunSystemCheck: () => void;
}) {
  const components: SystemComponentStatus[] = [
    systemHealth?.components.gmail ?? fallbackComponent("gmail", "ג׳ימייל", gmailConnected),
    systemHealth?.components.drive ?? fallbackComponent("drive", "גוגל דרייב", false),
    systemHealth?.components.sheets ?? fallbackComponent("sheets", "גוגל שיטס", false),
    systemHealth?.components.whatsapp ?? fallbackComponent("whatsapp", "וואטסאפ", whatsAppConnected),
    systemHealth?.components.database ?? fallbackComponent("database", "מסד נתונים", false),
  ];
  return (
    <ActivityCard title="חיבורי מערכת" empty="אין נתוני מערכת">
      {components.map((component) => (
        <DataRow
          key={component.name}
          title={systemComponentLabel(component.label)}
          meta={systemReasonLabel(component.reason) ?? "הבדיקה החיה עברה בהצלחה"}
          pill={<StatusPill tone={component.connected ? "success" : "danger"}>{component.connected ? "מחובר" : "לא מחובר"}</StatusPill>}
          action={!component.connected && component.name === "gmail" ? <SecondaryButton onClick={onConnectGmail}>חבר</SecondaryButton> : !component.connected && component.name === "whatsapp" ? <SecondaryButton onClick={onConnectWhatsApp}>חבר</SecondaryButton> : null}
        />
      ))}
      <div className="flex flex-wrap gap-3">
        <SecondaryButton onClick={onRunSystemCheck} disabled={systemChecking}>{systemChecking ? "בודק..." : "בדיקת מערכת"}</SecondaryButton>
        {showSystemCheck && <StatusPill tone={systemHealth?.allPassed ? "success" : "warn"}>{systemHealth?.allPassed ? "הכל תקין" : "יש נושאים לבדיקה"}</StatusPill>}
      </div>
    </ActivityCard>
  );
}

function WhatsAppCard({
  whatsAppConnected,
  whatsAppScanning,
  whatsAppScanRange,
  whatsAppScanResult,
  whatsAppStats,
  onRangeChange,
  onRun,
  onOpen,
}: {
  whatsAppConnected: boolean;
  whatsAppScanning: boolean;
  whatsAppScanRange: string;
  whatsAppScanResult: WhatsAppScanResult | null;
  whatsAppStats: WhatsAppAssistantStats | null;
  onRangeChange: (value: string) => void;
  onRun: () => void;
  onOpen: () => void;
}) {
  return (
    <ActivityCard title="וואטסאפ" empty="וואטסאפ לא מחובר">
      <DataRow title="הודעות היום" meta={`${formatNumber(whatsAppStats?.sentToday ?? 0)} נשלחו · ${formatNumber(whatsAppStats?.activeChats ?? 0)} שיחות פעילות`} pill={<StatusPill tone={whatsAppConnected ? "success" : "danger"}>{whatsAppConnected ? "מחובר" : "לא מחובר"}</StatusPill>} />
      <div className="grid gap-3 sm:grid-cols-2">
        <select value={whatsAppScanRange} onChange={(event) => onRangeChange(event.target.value)} disabled={whatsAppScanning || !whatsAppConnected}>
          <option value="7">7 ימים</option>
          <option value="30">30 ימים</option>
          <option value="90">90 ימים</option>
          <option value="full">סריקה מלאה</option>
        </select>
        <SecondaryButton onClick={onRun} disabled={whatsAppScanning || !whatsAppConnected}>{whatsAppScanning ? "סורק..." : "סריקת וואטסאפ"}</SecondaryButton>
      </div>
      {whatsAppScanResult && <p className={typography.body} style={{ color: colors.textSecondary }}>נסרקו {formatNumber(whatsAppScanResult.messagesScanned)} הודעות · נמצאו {formatNumber(whatsAppScanResult.supplierPaymentsFound)} תשלומי ספקים · {formatNumber(whatsAppScanResult.errorsCount)} שגיאות</p>}
      <SecondaryButton onClick={onOpen}>פתח מרכז וואטסאפ</SecondaryButton>
    </ActivityCard>
  );
}

function buildScanBannerState(activeScan: ScanProgressResult | null, scanStatus: ScanStatus | null): {
  status: "running" | "success" | "partial" | "truncated" | "error";
  found: number;
  scanned: number;
  totalMatched?: number | null;
  errors: number;
} | null {
  if (activeScan) {
    const truncated = activeScan.windowTruncated ?? activeScan.summary?.windowTruncated ?? false;
    return {
      status: activeScan.status === "running" ? "running" : truncated ? "truncated" : activeScan.status === "completed" ? "success" : activeScan.status,
      found: activeScan.invoicesFound + activeScan.supplierPaymentsFound,
      scanned: activeScan.emailsFetched,
      totalMatched: activeScan.totalMatched ?? activeScan.summary?.totalMatched,
      errors: activeScan.summary?.errorsCount ?? activeScan.finalSummary?.errorsCount ?? 0,
    };
  }
  if (!scanStatus?.last) return null;
  return {
    status: scanStatus.last.status === "running" ? "running" : scanStatus.last.windowTruncated ? "truncated" : scanStatus.last.status === "success" ? "success" : scanStatus.last.status === "partial" ? "partial" : "error",
    found: (scanStatus.last.invoicesFound ?? 0) + (scanStatus.last.paymentsFound ?? 0),
    scanned: scanStatus.last.found,
    totalMatched: scanStatus.last.totalMatched,
    errors: scanStatus.last.errors ? 1 : 0,
  };
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  if (hour >= 17 && hour < 22) return "ערב טוב";
  return "לילה טוב";
}

function scanProgressMessages(progress: ScanProgressResult) {
  return [
    progress.status === "running" ? "סורק ומעבד מיילים..." : progress.status === "error" ? "הסריקה נכשלה" : progress.status === "partial" ? `הסריקה הושלמה עם ${progress.summary?.errorsCount ?? progress.finalSummary?.errorsCount ?? 0} שגיאות` : "הסריקה הושלמה",
    `התקדמות ${progress.progressPercent ?? 0}%${progress.estimatedRemainingSeconds ? ` · נותרו בערך ${Math.ceil(progress.estimatedRemainingSeconds / 60)} דק׳` : ""}`,
    `נמצאו ${progress.emailsFetched} מיילים`,
    `נשמרו ${progress.emailsSaved} פריטי סריקה`,
  ];
}

function formatProgressSummary(progress: ScanProgressResult) {
  return appendScanTruncationMessage(
    `נמצאו ${progress.emailsFetched} מיילים · נשמרו ${progress.emailsSaved} · חשבוניות ${progress.invoicesFound} · תשלומי ספקים ${progress.supplierPaymentsFound} · דרייב ${progress.uploadedToDrive} · שיטס ${progress.sheetsUpdated ?? 0}`,
    progress.windowTruncated ?? progress.summary?.windowTruncated,
    progress.emailsFetched
  );
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
    windowTruncated: result.summary?.windowTruncated,
    totalMatched: result.summary?.totalMatched,
  };
}

function formatPartialScanMessage(progress: ScanProgressResult) {
  const errorsCount = progress.summary?.errorsCount ?? progress.finalSummary?.errorsCount ?? 0;
  return appendScanTruncationMessage(
    `הסריקה הושלמה עם ${errorsCount} שגיאות`,
    progress.windowTruncated ?? progress.summary?.windowTruncated,
    progress.emailsFetched
  );
}

function formatScanSuccess(summary: GmailScanSummary) {
  return appendScanTruncationMessage(
    `נבדקו ${summary.totalEmailsChecked ?? summary.emailsScanned} מיילים · נמצאו ${summary.relevantEmailsFound ?? summary.invoiceOrPaymentEmailsFound} רלוונטיים · נשמרו ${summary.recordsSaved} רשומות · לבדיקה ${summary.needsReviewCount ?? 0} · שגיאות ${summary.errorsCount ?? 0}`,
    summary.windowTruncated,
    summary.totalEmailsChecked ?? summary.emailsScanned
  );
}

function appendScanTruncationMessage(message: string, windowTruncated?: boolean, emailsScanned = 0) {
  return windowTruncated ? `${message} · נסרקו ${emailsScanned} הודעות — ייתכן שיש עוד, הרץ סריקה נוספת` : message;
}

function fallbackComponent(name: SystemComponentStatus["name"], label: string, connected: boolean): SystemComponentStatus {
  return { name, label, connected, status: connected ? "PASS" : "FAIL", reason: null };
}

function systemComponentLabel(label: string) {
  const labels: Record<string, string> = {
    gmail: "ג׳ימייל",
    drive: "גוגל דרייב",
    sheets: "גוגל שיטס",
    whatsapp: "וואטסאפ",
    database: "מסד נתונים",
  };
  return labels[label.toLowerCase()] ?? label;
}

function systemReasonLabel(reason: string | null) {
  if (!reason) return null;
  const labels: Record<string, string> = {
    connected: "מחובר",
    missing: "חסר חיבור",
    disconnected: "לא מחובר",
    failed: "נכשלה בדיקה",
  };
  return labels[reason] ?? reason.replace(/_/g, " ");
}

function alertTypeLabel(type: string) {
  const labels: Record<string, string> = { error: "שגיאה", warning: "אזהרה", info: "מידע", review: "לבדיקה" };
  return labels[type] ?? type.replace(/_/g, " ");
}

function taskPriorityLabel(priority: string) {
  const labels: Record<string, string> = { low: "עדיפות נמוכה", medium: "עדיפות בינונית", high: "עדיפות גבוהה" };
  return labels[priority] ?? priority.replace(/_/g, " ");
}

function isCompletedGmailScanStatus(status?: string) {
  return status === "completed" || status === "success" || status === "partial";
}

function isThisMonth(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function formatShekel(amount: number) {
  return `₪${Math.round(amount).toLocaleString("he-IL")}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("he-IL");
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("he-IL");
}

function relativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  return `לפני ${hours} שעות`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
