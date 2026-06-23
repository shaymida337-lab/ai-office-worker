"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, CalendarDays, CheckCircle2, ClipboardList, CreditCard, FileSearch } from "lucide-react";
import { Nav } from "@/components/Nav";
import {
  NatalieBriefing,
  NatalieConversationStrip,
  NataliePrimaryAction,
  NatalieQuietSummary,
  NatalieTimeline,
} from "@/components/natalie";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { ScanBanner } from "@/components/ui/ScanBanner";
import { StatusPill } from "@/components/ui/StatusPill";
import { buildNatalieBriefing, buildQuietSummary } from "@/lib/natalie/briefing";
import { inferReviewPresentation, natalieReviewMessage } from "@/lib/natalie/copy";
import { formatNatalieActivities } from "@/lib/natalie/narrative";
import type { NatalieActivityInput, NatalieBriefingInput } from "@/lib/natalie/types";
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
import { colors, radius, shadow, spacing, button, type as typography } from "@/lib/design-tokens";
import { labelFor } from "@/lib/labels";
import {
  gmailScanStillRunning,
  isFailedGmailScanStatus,
  isRunningScanStatusLog,
  isTerminalGmailScanProgress,
  isTerminalScanStatusLog,
  normalizeScanStatusFromLog,
} from "@/lib/gmailScanLifecycle";
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
  status: "running" | "queued" | "completed" | "partial" | "error" | "success" | "failed" | "cancelled" | "stale";
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
  reviewStatus?: string;
  source?: string;
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

type UpcomingAppointment = {
  id: string;
  startTime: string;
  status: string;
  client: { name: string };
};

type DocumentReview = {
  id: string;
  source: string;
  sender: string | null;
  subject: string | null;
  fileName: string | null;
  invoiceNumber?: string | null;
  documentDate?: string | null;
  documentType: string;
  supplierName: string | null;
  supplierTaxId?: string | null;
  totalAmount: number | null;
  currency?: string | null;
  confidenceScore: number;
  uncertaintyReason: string | null;
  parsedFieldsJson?: unknown;
  rawAnalysis?: unknown;
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
  const [successScanBannerHidden, setSuccessScanBannerHidden] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [missingInvoices, setMissingInvoices] = useState<Payment[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([]);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [documentReviews, setDocumentReviews] = useState<DocumentReview[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<UpcomingAppointment[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [showGmailConnect, setShowGmailConnect] = useState(false);
  const [error, setError] = useState("");
  const [invoiceAttachPaymentId, setInvoiceAttachPaymentId] = useState<string | null>(null);
  const [invoiceAttachLink, setInvoiceAttachLink] = useState("");
  const [natalieConversation, setNatalieConversation] = useState("");

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
      const appointmentFrom = new Date().toISOString();
      const appointmentTo = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const [statsResult, summaryResult, gmailResult, clientsResult, scanStatusResult, paymentsResult, missingResult, invoicesResult, tasksResult, alertsResult, orgResult, systemResult, reviewsResult, appointmentsResult] = await Promise.allSettled([
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
        apiFetch<UpcomingAppointment[]>(`/api/appointments?from=${encodeURIComponent(appointmentFrom)}&to=${encodeURIComponent(appointmentTo)}`),
      ]);

      setStats(statsResult.status === "fulfilled" ? statsResult.value : emptyStats);
      setSummary(summaryResult.status === "fulfilled" ? summaryResult.value.text : "לא ניתן לטעון סיכום כרגע.");
      setGmailStatus(gmailResult.status === "fulfilled" ? gmailResult.value : { googleConfigured: true, connected: false, connectedAt: null });
      setClients(clientsResult.status === "fulfilled" ? clientsResult.value : emptyClients);

      if (scanStatusResult.status === "fulfilled") {
        setScanStatus(scanStatusResult.value);
        const running = scanStatusResult.value.logs.find((log) => isRunningScanStatusLog(log));
        const trackedLog = activeScanId
          ? scanStatusResult.value.logs.find((log) => log.id === activeScanId)
          : null;

        if (trackedLog && isTerminalScanStatusLog(trackedLog)) {
          setActiveScanId(null);
          setActiveScan(null);
          setSyncing(false);
          setFirstScanRunning(false);
          setScanProgress([]);
          window.localStorage.removeItem("activeGmailScanId");
        } else if (running && !activeScanId) {
          setActiveScanId(running.id);
          window.localStorage.setItem("activeGmailScanId", running.id);
        } else if (!running) {
          setActiveScanId(null);
          setActiveScan(null);
          setSyncing(false);
          setFirstScanRunning(false);
          setScanProgress([]);
          window.localStorage.removeItem("activeGmailScanId");
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
      setUpcomingAppointments(
        appointmentsResult.status === "fulfilled"
          ? appointmentsResult.value.filter((appt) => appt.status !== "cancelled" && new Date(appt.startTime) >= new Date())
          : []
      );

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
    } finally {
      setPageLoading(false);
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

    const completeActiveScan = async (progress: ScanProgressResult) => {
      setFirstScanRunning(false);
      setSyncing(false);
      setActiveScan(null);
      setActiveScanId(null);
      setScanProgress([]);
      window.localStorage.removeItem("activeGmailScanId");

      if (isSuccessfulGmailScanProgress(progress)) {
        setFirstScanSummary(formatProgressSummary(progress));
        setScanToast({
          type: progress.status === "partial" ? "warning" : "success",
          text:
            progress.status === "partial"
              ? formatPartialScanMessage(progress)
              : "הסריקה הסתיימה והנתונים עודכנו",
        });
      } else {
        setScanToast({
          type: "error",
          text: progress.error ?? "הסריקה נכשלה",
        });
      }

      await load();
    };

    const poll = async () => {
      try {
        const progress = await apiFetch<ScanProgressResult>(`/api/gmail/scan/${activeScanId}`);
        if (cancelled) return;

        if (isTerminalGmailScanProgress(progress)) {
          await completeActiveScan(progress);
          return;
        }

        try {
          const automationStatus = await apiFetch<ScanStatus>("/api/automation/scan-status");
          if (cancelled) return;
          const trackedLog = automationStatus.logs.find((log) => log.id === activeScanId);
          if (trackedLog && isTerminalScanStatusLog(trackedLog)) {
            await completeActiveScan({
              ...progress,
              status: normalizeScanStatusFromLog(trackedLog.status, progress.status),
              inProgress: false,
              finishedAt: trackedLog.endedAt ?? progress.finishedAt,
              error: trackedLog.errors ?? progress.error,
            });
            return;
          }
        } catch {
          // Keep polling progress endpoint if scan-status fallback is unavailable.
        }

        setActiveScan(progress);
        setScanProgress(scanProgressMessages(progress));
      } catch (err) {
        if (!cancelled) {
          setScanToast({ type: "error", text: err instanceof Error ? err.message : "טעינת סטטוס סריקה נכשלה" });
        }
      }
    };

    poll().catch(() => undefined);
    const interval = window.setInterval(() => poll().catch(() => undefined), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeScanId, load]);

  useEffect(() => {
    const banner = buildScanBannerState(activeScan, scanStatus);
    if (banner?.status !== "success" || banner.errors > 0) {
      setSuccessScanBannerHidden(false);
      return;
    }
    setSuccessScanBannerHidden(false);
    const timeout = window.setTimeout(() => setSuccessScanBannerHidden(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [activeScan, scanStatus]);

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
  const ownerFirstName = firstNameFromLabel(organizationSettings?.name);
  const scanBanner = successScanBannerHidden ? null : buildScanBannerState(activeScan, scanStatus);
  const monthPayments = payments.filter((payment) => isThisMonth(payment.date));
  const unpaidPayments = useMemo(() => payments.filter((payment) => !payment.paid), [payments]);
  const openTasksCount = stats?.openTasks ?? recentTasks.filter((task) => task.status !== "completed" && task.status !== "done").length;
  const upcomingMeetingsCount = upcomingAppointments.length;
  const scanRunning = syncing || Boolean(activeScanId) || scanBanner?.status === "running";
  const scanStale = scanBanner?.status === "stale";

  const natalieBriefingInput = useMemo<NatalieBriefingInput>(
    () => ({
      screen: "today",
      ownerFirstName,
      gmailConnected,
      scanRunning,
      scanStale,
      documentReviews: documentReviews.map((item) => ({
        id: item.id,
        supplierName: item.supplierName,
        reviewStatus: item.reviewStatus,
        uncertaintyReason: item.uncertaintyReason,
        documentType: item.documentType,
        totalAmount: item.totalAmount,
        currency: item.currency,
      })),
      unpaidPayments: unpaidPayments.map((payment) => ({
        id: payment.id,
        supplier: payment.supplier,
        paid: payment.paid,
        missingInvoice: payment.missingInvoice,
        amount: payment.amount,
        currency: payment.currency,
      })),
      missingInvoices: missingInvoices.map((payment) => ({
        id: payment.id,
        supplier: payment.supplier,
        paid: payment.paid,
        missingInvoice: true,
        amount: payment.amount,
        currency: payment.currency,
      })),
      openTasksCount,
      upcomingAppointments: upcomingAppointments.map((appt) => ({
        id: appt.id,
        clientName: appt.client.name,
        startTime: appt.startTime,
        status: appt.status,
      })),
      invoicesSaved: monthPayments.length,
      paymentsPrepared: unpaidPayments.length,
    }),
    [
      ownerFirstName,
      gmailConnected,
      scanRunning,
      scanStale,
      documentReviews,
      unpaidPayments,
      missingInvoices,
      openTasksCount,
      upcomingAppointments,
      monthPayments.length,
    ]
  );

  const natalieBriefing = useMemo(() => buildNatalieBriefing(natalieBriefingInput), [natalieBriefingInput]);
  const natalieQuietSummary = useMemo(() => buildQuietSummary(natalieBriefingInput), [natalieBriefingInput]);
  const natalieTimeline = useMemo(
    () => formatNatalieActivities(buildDashboardActivityInputs(recentInvoices, recentTasks, payments, scanStatus)),
    [recentInvoices, recentTasks, payments, scanStatus]
  );

  const priorityItems = buildPriorityItems(documentReviews, missingInvoices, payments, alerts);
  const visiblePriorityItems = priorityItems.slice(0, 5);

  const handleNataliePrimaryAction = useCallback(
    (intent: string) => {
      const action = natalieBriefing.primaryAction;
      if (action.disabled) return;
      if (action.href && intent !== "start_today") {
        router.push(action.href);
        return;
      }
      if (intent === "connect_gmail") {
        connectGmail();
        return;
      }
      document.getElementById("natalie-decisions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [natalieBriefing.primaryAction, router, connectGmail]
  );

  const handleNatalieConversation = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setNatalieConversation("");
      if (trimmed.includes("תשלום") || trimmed.includes("שולם")) {
        router.push("/payments");
        return;
      }
      if (trimmed.includes("ממתין") || trimmed.includes("התחל") || trimmed.includes("דחוף")) {
        document.getElementById("natalie-decisions")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      setActionMessage("קיבלתי את הבקשה. נטלי ממשיכה לעבוד — אפשר גם לדבר איתי דרך כפתור נטלי למטה.");
    },
    [router]
  );

  return (
    <main
      className="min-h-screen max-w-full overflow-x-clip px-4 pb-24 pt-20 md:px-8 md:pb-8 lg:mr-60"
      style={{
        backgroundColor: colors.bg,
        color: colors.textPrimary,
        backgroundImage:
          "radial-gradient(circle at top right, rgba(29,91,255,0.08), transparent 28rem), radial-gradient(circle at 10% 20%, rgba(31,170,89,0.05), transparent 22rem)",
      }}
    >
      <Nav />

      <div className={`grid min-w-0 max-w-full ${spacing.section}`}>
        <MessageStack error={error} actionMessage={actionMessage} toast={scanToast} />

        {showGmailConnect && (
          <section
            className={`${radius.card} ${shadow.card} ${spacing.card}`}
            style={{ backgroundColor: colors.surface, border: `1px solid ${colors.warnBorder}` }}
          >
            <div className={typography.cardTitle} style={{ color: colors.textPrimary }}>צריך לחבר ג׳ימייל</div>
            <p className={`${typography.body} mt-3`} style={{ color: colors.textSecondary }}>
              חיבור ג׳ימייל נדרש כדי שנוכל לסרוק ולארגן את המסמכים שלך.
            </p>
            <button
              type="button"
              onClick={connectGmail}
              className={`${radius.control} mt-5 ${button.primary}`}
              style={{ backgroundColor: colors.accent, border: `1px solid ${colors.accent}`, color: colors.surface }}
            >
              התחבר לג׳ימייל
            </button>
          </section>
        )}

        <section
          className={`${radius.card} ${shadow.card} ${spacing.card} border`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
          aria-label="היום עם נטלי"
        >
          <div className="mb-4">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 ${typography.badge} ${radius.pill}`}
              style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
            >
              העוזרת החכמה שלך פעילה
            </span>
          </div>
          <div className={`natalie-briefing-shell space-y-4 [&_h1]:text-[32px] [&_h1]:font-extrabold [&_h1]:leading-tight [&_h2]:text-lg [&_h2]:font-bold [&_header>p]:mt-2 [&_header>p]:text-lg [&_header>p]:font-medium [&_header>p]:leading-8 [&_li]:text-base [&_li]:leading-7 md:[&_h1]:text-[40px]`}>
            <NatalieBriefing
              briefing={{
                ...natalieBriefing,
                greeting: `${natalieBriefing.greeting} 👋`,
              }}
            />
          </div>
        </section>

        {scanBanner && (
          <ScanBanner
            status={scanBanner.status}
            found={scanBanner.found}
            scanned={scanBanner.scanned}
            totalMatched={scanBanner.totalMatched}
            errors={scanBanner.errors}
          />
        )}

        <section className="grid gap-4 sm:flex sm:flex-wrap sm:items-center">
          <NataliePrimaryAction
            action={natalieBriefing.primaryAction}
            onAction={handleNataliePrimaryAction}
            className={`${radius.control} ${button.primary} w-full border border-transparent bg-[#1D5BFF] text-white shadow-[0_12px_28px_rgba(29,91,255,0.24)] sm:w-auto`}
          />
          <button
            type="button"
            onClick={runSync}
            disabled={syncing || Boolean(activeScanId)}
            className={`${radius.control} ${button.secondary} w-full sm:w-auto`}
            style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
          >
            {syncing || activeScanId ? "סורקת..." : "סרוק עכשיו"}
          </button>
        </section>

        <section
          className={`${radius.card} ${shadow.card} ${spacing.card} border`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          <NatalieConversationStrip
            placeholder="מה תרצה שאעשה?"
            suggestions={natalieBriefing.suggestedQuestions}
            value={natalieConversation}
            onChange={setNatalieConversation}
            onSubmit={handleNatalieConversation}
            onSuggestionSelect={(suggestion) => {
              setNatalieConversation(suggestion);
              handleNatalieConversation(suggestion);
            }}
          />
        </section>

        <section id="natalie-decisions" className={`grid ${spacing.section}`}>
          <SectionTitle
            icon={<ClipboardList className="h-[22px] w-[22px]" strokeWidth={2.2} />}
            title="מה דורש את ההחלטה שלך"
            hint="נטלי ממיינת עבורך את הדברים הדחופים ביותר"
          />
          {pageLoading ? (
            <DashboardSkeletonRows count={3} />
          ) : visiblePriorityItems.length > 0 ? (
            <div className={`grid ${spacing.inline}`}>
              {visiblePriorityItems.map((item) => (
                <PriorityRow key={item.id} item={item} onMarkPaid={markPaymentPaid} onAttach={attachInvoiceToPayment} />
              ))}
              {priorityItems.length > visiblePriorityItems.length && (
                <a href="/dashboard/document-reviews" className={`${typography.body} font-bold`} style={{ color: colors.accent }}>
                  לכל מה שממתין ({priorityItems.length}) ←
                </a>
              )}
            </div>
          ) : (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6" />}
              title="הכל מסודר כרגע ✓"
              hint="אין מסמכים, תשלומים או התראות שדורשים את ההחלטה שלך"
            />
          )}
        </section>

        <section
          className={`${radius.card} ${spacing.card} border`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          <h2 className={`${typography.sectionHeader} mb-4`} style={{ color: colors.textPrimary }}>
            סיכום שקט
          </h2>
          <NatalieQuietSummary chips={natalieQuietSummary} />
        </section>

        <section className={`grid grid-cols-2 md:grid-cols-4 ${spacing.inline}`}>
          <KpiCard
            title="מסמכים שממתינים לאישור"
            value={formatNumber(documentReviews.length)}
            subtitle={documentReviews.length > 0 ? "דורשים את תשומת לבך" : "הכל מאושר"}
            accent="amber"
            loading={pageLoading}
            icon={<FileSearch className="h-6 w-6" strokeWidth={2.1} />}
          />
          <KpiCard
            title="תשלומים החודש"
            value={pageLoading ? "—" : formatNumber(monthPayments.length)}
            subtitle={pageLoading ? undefined : formatShekel(monthPayments.reduce((sum, p) => sum + p.amount, 0))}
            accent="blue"
            loading={pageLoading}
            icon={<CreditCard className="h-6 w-6" strokeWidth={2.1} />}
          />
          <KpiCard
            title="משימות פתוחות"
            value={formatNumber(openTasksCount)}
            subtitle="מעקב אחרי מה שעדיין פתוח"
            accent="green"
            loading={pageLoading}
            icon={<CheckCircle2 className="h-6 w-6" strokeWidth={2.1} />}
          />
          <KpiCard
            title="פגישות קרובות"
            value={formatNumber(upcomingMeetingsCount)}
            subtitle={upcomingMeetingsCount > 0 ? "בשבועיים הקרובים" : "אין פגישות מתוכננות"}
            accent="violet"
            loading={pageLoading}
            icon={<CalendarDays className="h-6 w-6" strokeWidth={2.1} />}
          />
        </section>

        <section className={`grid ${spacing.section}`}>
          <SectionTitle
            icon={<Activity className="h-[22px] w-[22px]" strokeWidth={2.2} />}
            title="מה עשיתי לאחרונה"
            hint="עדכונים אחרונים מהעסק שלך"
          />
          {pageLoading ? (
            <DashboardSkeletonRows count={4} />
          ) : natalieTimeline.length > 0 ? (
            <section
              className={`${radius.card} ${shadow.card} ${spacing.card} border`}
              style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
            >
              <NatalieTimeline items={natalieTimeline} title="" />
            </section>
          ) : (
            <EmptyState title="עדיין אין פעילות" hint="כשאסיים לעבוד על מסמכים ותשלומים, זה יופיע כאן" compact />
          )}
        </section>

        <details className={`${radius.card} border`} style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}>
          <summary className="cursor-pointer list-none px-5 py-5 text-lg font-bold md:px-6" style={{ color: colors.textPrimary }}>
            כלים ואוטומציה
          </summary>
          <div className={`grid ${spacing.section} border-t p-5 md:p-6`} style={{ borderColor: colors.borderSubtle }}>
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
            </section>

            <section className={`grid ${spacing.section} lg:grid-cols-2`}>
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
        </details>
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
              <button className={`${radius.control} ${button.primary}`} style={{ backgroundColor: colors.accent, border: `1px solid ${colors.accent}`, color: colors.surface }} type="submit" disabled={!invoiceAttachLink.trim()}>צרף חשבונית</button>
              <SecondaryButton type="button" onClick={() => setInvoiceAttachPaymentId(null)}>ביטול</SecondaryButton>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function SectionTitle({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="space-y-2 pb-1">
      <div className="flex items-center gap-3">
        {icon && (
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
          >
            {icon}
          </span>
        )}
        <h2 className={typography.sectionHeader} style={{ color: colors.textPrimary }}>{title}</h2>
      </div>
      {hint && <p className={`${typography.body} pr-1`} style={{ color: colors.textSecondary }}>{hint}</p>}
    </div>
  );
}

function ReviewRow({ item }: { item: DocumentReview }) {
  const title = reviewTitle(item);
  const description = reviewDescription(item);
  return (
    <article
      className={`${radius.card} ${shadow.soft} ${spacing.card}`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.borderSubtle}` }}
    >
      <div className="grid gap-3 sm:grid-cols-4 sm:items-center">
        <div className="sm:col-span-2">
          <div className={`${typography.body} font-semibold`} style={{ color: colors.textPrimary }}>{title}</div>
          <div className={`${typography.caption} mt-1.5`} style={{ color: colors.textSecondary }}>{description}</div>
        </div>
        <div className={typography.body} style={{ color: colors.textPrimary }}>
          {formatMoney(item.totalAmount ?? 0, item.currency ?? "ILS")} · {formatDate(item.documentDate ?? item.createdAt)}
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
  return firstText(
    item.supplierName,
    item.sender,
    stringFromUnknown(item.parsedFieldsJson, ["supplierName", "supplier", "vendorName", "businessName"]),
    stringFromUnknown(item.rawAnalysis, ["supplierName", "supplier", "vendorName", "businessName"]),
    sourceLabel(item.source),
    "ספק לא ידוע"
  );
}

function reviewDescription(item: DocumentReview) {
  const documentLabel = labelFor("documentType", item.documentType);
  const subjectAndFile = [item.subject, item.fileName].map((value) => value?.trim()).filter(Boolean).join(" · ");
  return firstText(
    subjectAndFile,
    item.subject,
    item.fileName,
    item.invoiceNumber ? `${documentLabel} ${item.invoiceNumber}` : null,
    stringFromUnknown(item.parsedFieldsJson, ["description", "title", "subject", "fileName", "invoiceNumber"]),
    stringFromUnknown(item.rawAnalysis, ["description", "title", "subject", "fileName", "invoiceNumber"]),
    item.uncertaintyReason,
    documentLabel,
    "מסמך לבדיקה"
  );
}

function sourceLabel(source: string) {
  return source === "whatsapp" ? "וואטסאפ" : source === "gmail" ? "ג׳ימייל" : source.replace(/_/g, " ");
}

function firstText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function stringFromUnknown(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

function ActivityCard({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Boolean(children) && (!Array.isArray(children) || children.length > 0);
  return (
    <section
      className={`${radius.card} ${shadow.card} ${spacing.card}`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.borderSubtle}` }}
    >
      {title ? <h2 className={typography.cardTitle} style={{ color: colors.textPrimary }}>{title}</h2> : null}
      <div className={`${title ? "mt-5" : ""} grid ${spacing.inline}`}>
        {hasChildren ? children : <EmptyState title={empty} compact />}
      </div>
    </section>
  );
}

function DataRow({ title, meta, pill, action }: { title: ReactNode; meta: ReactNode; pill?: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={`${radius.control} flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5`}
      style={{ backgroundColor: colors.bgSoft, border: `1px solid ${colors.borderSubtle}` }}
    >
      <div className="min-w-0 flex-1">
        <div className={`${typography.cardTitle} truncate`} style={{ color: colors.textPrimary }}>{title}</div>
        <div className={`${typography.caption} mt-1.5 break-words min-w-0`} style={{ color: colors.textSecondary }}>{meta}</div>
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
  return <div className={`${radius.card} ${spacing.card} border ${typography.body} font-bold leading-7`} style={style}>{children}</div>;
}

function SecondaryButton({ children, onClick, disabled, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${radius.control} ${button.secondary} disabled:opacity-60`}
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
      className={`${radius.control} inline-flex ${button.secondary} items-center justify-center`}
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
  status: "running" | "success" | "partial" | "truncated" | "stale" | "error";
  found: number;
  scanned: number;
  totalMatched?: number | null;
  errors: number;
} | null {
  if (activeScan) {
    return {
      status: mapProgressToBannerStatus(activeScan),
      found: activeScan.invoicesFound + activeScan.supplierPaymentsFound,
      scanned: activeScan.emailsFetched,
      totalMatched: activeScan.totalMatched ?? activeScan.summary?.totalMatched,
      errors: activeScan.summary?.errorsCount ?? activeScan.finalSummary?.errorsCount ?? 0,
    };
  }
  if (!scanStatus?.last) return null;
  if (isRunningScanStatusLog(scanStatus.last)) {
    return {
      status: "running",
      found: (scanStatus.last.invoicesFound ?? 0) + (scanStatus.last.paymentsFound ?? 0),
      scanned: scanStatus.last.found,
      totalMatched: scanStatus.last.totalMatched,
      errors: scanStatus.last.errors ? 1 : 0,
    };
  }
  return {
    status: scanStatus.last.windowTruncated
      ? "truncated"
      : scanStatus.last.status === "stale" || scanStatus.last.status === "cancelled"
        ? "stale"
        : scanStatus.last.status === "success" || scanStatus.last.status === "completed"
          ? "success"
          : scanStatus.last.status === "partial"
            ? "partial"
            : "error",
    found: (scanStatus.last.invoicesFound ?? 0) + (scanStatus.last.paymentsFound ?? 0),
    scanned: scanStatus.last.found,
    totalMatched: scanStatus.last.totalMatched,
    errors: scanStatus.last.errors ? 1 : 0,
  };
}

function buildDashboardActivityInputs(
  invoices: RecentInvoice[],
  tasks: Task[],
  allPayments: Payment[],
  scan: ScanStatus | null
): NatalieActivityInput[] {
  const items: NatalieActivityInput[] = [];

  for (const invoice of invoices.slice(0, 3)) {
    items.push({
      id: `invoice-${invoice.id}`,
      kind: "invoice_saved",
      supplierName: invoice.client?.name ?? undefined,
      amount: invoice.amount,
      currency: invoice.currency,
      occurredAt: invoice.date,
    });
  }

  for (const task of tasks.slice(0, 2)) {
    items.push({
      id: `task-${task.id}`,
      kind: "task_created",
      title: task.title,
      occurredAt: task.updatedAt,
    });
  }

  for (const payment of allPayments.slice(0, 2)) {
    items.push({
      id: `payment-${payment.id}`,
      kind: payment.paid ? "payment_paid" : "payment_prepared",
      supplierName: payment.supplier,
      amount: payment.amount,
      currency: payment.currency,
      occurredAt: payment.date,
    });
  }

  if (scan?.last && (scan.last.status === "success" || scan.last.status === "completed")) {
    items.push({
      id: `scan-${scan.last.id}`,
      kind: "scan_completed",
      occurredAt: scan.last.endedAt ?? scan.last.startedAt,
    });
  }

  return items.slice(0, 6);
}

function firstNameFromLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

type PriorityItem = {
  id: string;
  kind: "review" | "missing" | "payment" | "alert";
  title: string;
  meta: string;
  pill: ReactNode;
  action?: ReactNode;
  paymentId?: string;
};

function buildPriorityItems(
  reviews: DocumentReview[],
  missing: Payment[],
  allPayments: Payment[],
  alertItems: AlertItem[]
): PriorityItem[] {
  const items: PriorityItem[] = [];

  for (const item of reviews.slice(0, 3)) {
    const presentation = inferReviewPresentation({
      reviewStatus: item.reviewStatus,
      uncertaintyReason: item.uncertaintyReason,
    });
    items.push({
      id: `review-${item.id}`,
      kind: "review",
      title: natalieReviewMessage(presentation, {
        supplierName: item.supplierName,
        uncertaintyReason: item.uncertaintyReason,
      }).replace(/\n/g, " "),
      meta: `${formatMoney(item.totalAmount ?? 0, item.currency ?? "ILS")} · ${formatDate(item.documentDate ?? item.createdAt)}`,
      pill: <StatusPill tone="warn">אני צריכה את ההחלטה שלך</StatusPill>,
      action: <SecondaryLink href="/dashboard/document-reviews">עזרי לי לבחור</SecondaryLink>,
    });
  }

  for (const payment of missing.slice(0, 2)) {
    items.push({
      id: `missing-${payment.id}`,
      kind: "missing",
      title: payment.supplier || "ספק לא ידוע",
      meta: `חשבונית חסרה · ${formatDate(payment.date)}`,
      pill: <StatusPill tone="warn">חסרה</StatusPill>,
      paymentId: payment.id,
    });
  }

  for (const payment of allPayments.filter((p) => !p.paid).slice(0, 2)) {
    items.push({
      id: `payment-${payment.id}`,
      kind: "payment",
      title: payment.supplier || "ספק לא ידוע",
      meta: `תשלום פתוח · ${formatShekel(payment.amount)}`,
      pill: <StatusPill tone="warn">ממתין</StatusPill>,
      paymentId: payment.id,
    });
  }

  for (const alert of alertItems.slice(0, 2)) {
    items.push({
      id: `alert-${alert.id}`,
      kind: "alert",
      title: alert.title,
      meta: alert.body ?? formatDateTime(alert.createdAt),
      pill: <StatusPill tone={alert.type === "error" ? "danger" : "warn"}>{alertTypeLabel(alert.type)}</StatusPill>,
    });
  }

  return items.slice(0, 6);
}

function PriorityRow({
  item,
  onMarkPaid,
  onAttach,
}: {
  item: PriorityItem;
  onMarkPaid: (id: string) => void;
  onAttach: (id: string) => void;
}) {
  const action =
    item.action ??
    (item.kind === "payment" && item.paymentId ? (
      <SecondaryButton onClick={() => onMarkPaid(item.paymentId!)}>סמן שולם</SecondaryButton>
    ) : item.kind === "missing" && item.paymentId ? (
      <SecondaryButton onClick={() => onAttach(item.paymentId!)}>צרף קישור</SecondaryButton>
    ) : null);

  return <DataRow title={item.title} meta={item.meta} pill={item.pill} action={action} />;
}

function DashboardSkeletonRows({ count }: { count: number }) {
  return (
    <div className={`grid ${spacing.inline}`}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={`${radius.control} h-20 animate-pulse`}
          style={{ backgroundColor: colors.bgSoft, border: `1px solid ${colors.borderSubtle}` }}
        />
      ))}
    </div>
  );
}

function scanProgressMessages(progress: ScanProgressResult) {
  const statusMessage = gmailScanStillRunning(progress)
    ? "סורק ומעבד מיילים..."
    : isFailedGmailScanStatus(progress.status)
      ? "הסריקה נכשלה"
      : progress.status === "partial"
        ? `הסריקה הושלמה עם ${progress.summary?.errorsCount ?? progress.finalSummary?.errorsCount ?? 0} שגיאות`
        : "הסריקה הושלמה";

  return [
    statusMessage,
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

function isSuccessfulGmailScanProgress(progress: ScanProgressResult) {
  return (
    progress.status === "completed" ||
    progress.status === "success" ||
    progress.status === "partial"
  );
}

function mapProgressToBannerStatus(progress: ScanProgressResult): "running" | "success" | "partial" | "truncated" | "stale" | "error" {
  if (gmailScanStillRunning(progress)) return "running";
  const truncated = progress.windowTruncated ?? progress.summary?.windowTruncated ?? false;
  if (truncated) return "truncated";
  if (progress.status === "partial") return "partial";
  if (progress.status === "stale" || progress.status === "cancelled") return "stale";
  if (isSuccessfulGmailScanProgress(progress)) return "success";
  return "error";
}

function isThisMonth(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function formatShekel(amount: number) {
  return `₪${Math.round(amount).toLocaleString("he-IL")}`;
}

function formatMoney(amount: number, currency: string) {
  if (currency === "ILS") return formatShekel(amount);
  return `${currency} ${Math.round(amount).toLocaleString("he-IL")}`;
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
