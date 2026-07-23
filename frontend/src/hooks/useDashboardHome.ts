"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { consumeFirstDashboardVisit } from "@/lib/natalie/firstDay";
import { formatFirstScanEmptyMessage } from "@/lib/dashboard/home";
import { lockUiOverlay, unlockUiOverlay } from "@/lib/ui-overlay";
import {
  fetchBriefingSchedulingSnapshot,
  type BriefingSchedulingSnapshot,
} from "@/lib/scheduling/briefing";
import {
  apiFetch,
  ApiError,
  clearToken,
  getToken,
  isAuthError,
  type DashboardStats,
  type GmailStatus,
  type Payment,
  type Task,
} from "@/lib/api";
import {
  isSuccessfulGmailScanProgress,
} from "@/lib/gmailScanBanner";
import {
  isAdoptableRunningScanLog,
  isPausedGmailScanStatus,
  isRunningScanStatusLog,
  isTerminalGmailScanProgress,
  isTerminalScanStatusLog,
  normalizeScanStatusFromLog,
  SCAN_STUCK_USER_MESSAGE_HE,
  scanDocumentsFound,
} from "@/lib/gmailScanLifecycle";
import type { OrganizationSettings } from "@/lib/business-config";
import { getBusinessModule } from "@/lib/business-module";
import { resolveGmailTruthAfterLoad, shouldAutoTriggerGmailConnect } from "@/lib/integrations/gmailConnectionTruth";
import {
  buildOptimisticGmailConnectedStatus,
  cleanGmailOAuthReturnUrl,
  gmailOAuthErrorMessage,
  parseGmailOAuthReturn,
  shouldHandleGmailOAuthErrorReturn,
  shouldHandleGmailOAuthReturn,
} from "@/lib/integrations/gmailOAuthReturn";
import { GMAIL_SCAN_POLL_INTERVAL_MS, MAX_GMAIL_SCAN_POLL_ATTEMPTS } from "@/lib/dashboard/scanPollLimits";
import { createDashboardSyncRetryRequest } from "@/lib/dashboard/dashboardSyncRetry";
import { resolveScanStatusFromSettled } from "@/lib/dashboard/scanStatusTruth";
import { buildDashboardHomeViewModel } from "@/lib/dashboard/buildDashboardHomeViewModel";
import {
  type DashboardHomeMetricsResponse,
  snapshotFromHomeMetrics,
} from "@/lib/dashboard/homeMetrics";
import { runDashboardHomeLoadPhases } from "@/lib/dashboard/dashboardHomeLoadPlan";
import {
  getDashboardBootstrapDebugCounters,
  invalidateDashboardBootstrap,
  loadDashboardBootstrap,
} from "@/lib/dashboard/dashboardBootstrapStore";
import { setOrganizationSettingsCache } from "@/lib/organization/organizationSettingsStore";
import {
  conversationRequestsGmailScan,
  conversationRequestsScanProgress,
} from "@/lib/dashboard/dashboardActionFeedback";
import {
  delay,
  formatPartialScanMessage,
  formatProgressSummary,
  formatScanSuccess,
  phaseLabelForScanProgress,
  scanProgressMessages,
  scanSummaryFromResult,
} from "@/lib/dashboard/homePageHelpers";
import type {
  AccountantSummary,
  AlertItem,
  ClientsResponse,
  DocumentReviewHomeItem,
  DocumentReviewsHomeSummaryResponse,
  GmailScanResult,
  RecentInvoice,
  ScanProgressResult,
  ScanStatus,
  ScanToast,
  SystemHealth,
  UpcomingAppointment,
  WhatsAppAssistantStats,
  WhatsAppScanResult,
} from "@/lib/dashboard/homePageTypes";

/** Temporary FP diagnostics — enable with localStorage.DASHBOARD_FP_DEBUG=1 (no secrets logged). */
function isDashboardFpDebugEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem("DASHBOARD_FP_DEBUG") === "1";
  } catch {
    return false;
  }
}

function fpDebugLog(event: string, data: Record<string, string | number | boolean | null | undefined>) {
  if (!isDashboardFpDebugEnabled()) return;
  console.info(`[dashboard-fp] ${event}`, data);
}

async function timedFpRequest<T>(
  name: string,
  pageLoadingFalseAt: number | null,
  originMs: number,
  run: () => Promise<T>
): Promise<T> {
  if (!isDashboardFpDebugEnabled()) return run();
  const markStart = `${name}_start`;
  const markEnd = `${name}_end`;
  const t0 = performance.now();
  try {
    performance.mark(markStart);
  } catch {
    /* ignore */
  }
  fpDebugLog(markStart, {
    sinceMountMs: Math.round(t0 - originMs),
    beforePageLoadingFalse: pageLoadingFalseAt == null,
  });
  try {
    const value = await run();
    const durationMs = Math.round(performance.now() - t0);
    try {
      performance.mark(markEnd);
      performance.measure(name, markStart, markEnd);
    } catch {
      /* ignore */
    }
    fpDebugLog(markEnd, {
      durationMs,
      success: true,
      beforePageLoadingFalse: pageLoadingFalseAt == null,
      sinceMountMs: Math.round(performance.now() - originMs),
    });
    return value;
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    try {
      performance.mark(markEnd);
      performance.measure(name, markStart, markEnd);
    } catch {
      /* ignore */
    }
    fpDebugLog(markEnd, {
      durationMs,
      success: false,
      beforePageLoadingFalse: pageLoadingFalseAt == null,
      sinceMountMs: Math.round(performance.now() - originMs),
      errorName: err instanceof Error ? err.name : "error",
    });
    throw err;
  }
}

export function useDashboardHome() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailStatusKnown, setGmailStatusKnown] = useState(false);
  const [gmailStatusStale, setGmailStatusStale] = useState(false);
  const [clients, setClients] = useState<ClientsResponse | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [scanStatusKnown, setScanStatusKnown] = useState(false);
  const [scanStatusStale, setScanStatusStale] = useState(false);
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [whatsAppStats, setWhatsAppStats] = useState<WhatsAppAssistantStats | null>(null);
  const [accountantSummary, setAccountantSummary] = useState<AccountantSummary | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [systemHealthFetchFailed, setSystemHealthFetchFailed] = useState(false);
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
  const [documentReviews, setDocumentReviews] = useState<DocumentReviewHomeItem[]>([]);
  /** Full needs_review count from GET /api/document-reviews?view=summary (UI list; metrics use /dashboard/home-metrics). */
  const [pendingDocumentReviewsCount, setPendingDocumentReviewsCount] = useState(0);
  const [homeMetrics, setHomeMetrics] = useState<DashboardHomeMetricsResponse | null>(null);
  const [homeMetricsLoaded, setHomeMetricsLoaded] = useState(false);
  const [homeMetricsError, setHomeMetricsError] = useState(false);
  const [upcomingAppointments, setUpcomingAppointments] = useState<UpcomingAppointment[]>([]);
  const [briefingScheduling, setBriefingScheduling] = useState<BriefingSchedulingSnapshot | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [showGmailConnect, setShowGmailConnect] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [error, setError] = useState("");
  const [invoiceAttachPaymentId, setInvoiceAttachPaymentId] = useState<string | null>(null);
  const [invoiceAttachLink, setInvoiceAttachLink] = useState("");
  const [clientMounted, setClientMounted] = useState(false);
  const [firstVisitMode, setFirstVisitMode] = useState(false);
  const [firstScanSettled, setFirstScanSettled] = useState(false);
  const [firstScanPhase, setFirstScanPhase] = useState<string | null>(null);
  const connectGmailTriggeredRef = useRef(false);
  const syncingRef = useRef(false);
  const paymentActionInFlightRef = useRef(false);
  const invoiceAttachInFlightRef = useRef(false);
  const gmailOAuthReturnHandledRef = useRef(false);
  const autoFirstScanRef = useRef(false);
  /** Bumps on every load() so stale Background results cannot overwrite newer state. */
  const loadGenerationRef = useRef(0);
  /** First Paint wall-clock origin for relative "before/after pageLoading=false" logs. */
  const fpDebugOriginRef = useRef(0);
  const pageLoadingFalseAtRef = useRef<number | null>(null);
  const heroRenderedLoggedRef = useRef(false);

  useEffect(() => {
    setClientMounted(true);
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("firstVisit") === "1";
    const fromSession = consumeFirstDashboardVisit();
    if (fromUrl || fromSession) {
      setFirstVisitMode(true);
      if (fromUrl) router.replace("/dashboard");
    }
    if (isDashboardFpDebugEnabled()) {
      fpDebugOriginRef.current = performance.now();
      pageLoadingFalseAtRef.current = null;
      heroRenderedLoggedRef.current = false;
      performance.mark("dashboard_mount");
      fpDebugLog("dashboard_mount", { t: 0 });
    }
  }, [router]);

  useEffect(() => {
    if (!isDashboardFpDebugEnabled()) return;
    if (pageLoading) return;
    if (pageLoadingFalseAtRef.current == null) {
      pageLoadingFalseAtRef.current = performance.now();
      try {
        performance.mark("pageLoading_false");
        if (fpDebugOriginRef.current > 0) {
          performance.measure("dashboard_to_pageLoading_false", "dashboard_mount", "pageLoading_false");
        }
      } catch {
        /* ignore */
      }
      let organizationSettingsNetworkCount: number | null = null;
      try {
        organizationSettingsNetworkCount = performance
          .getEntriesByType("resource")
          .filter((entry) => String((entry as PerformanceResourceTiming).name ?? "").includes("/api/organization/settings"))
          .length;
      } catch {
        organizationSettingsNetworkCount = null;
      }
      fpDebugLog("pageLoading_false", {
        sinceMountMs: Math.round(pageLoadingFalseAtRef.current - fpDebugOriginRef.current),
        organizationSettingsNetworkCount,
      });
    }
    if (!heroRenderedLoggedRef.current && (homeMetricsLoaded || homeMetricsError)) {
      heroRenderedLoggedRef.current = true;
      try {
        performance.mark("hero_ready");
        if (fpDebugOriginRef.current > 0) {
          performance.measure("dashboard_to_hero_ready", "dashboard_mount", "hero_ready");
        }
      } catch {
        /* ignore */
      }
      fpDebugLog("hero_ready", {
        sinceMountMs: Math.round(performance.now() - fpDebugOriginRef.current),
        afterPageLoadingFalse: true,
        homeMetricsLoaded,
        homeMetricsError,
      });
    }
  }, [pageLoading, homeMetricsLoaded, homeMetricsError]);

  useEffect(() => {
    if (!isDashboardFpDebugEnabled()) return;
    if (!homeMetricsLoaded) return;
    fpDebugLog("homeMetricsLoaded", {
      sinceMountMs: Math.round(performance.now() - (fpDebugOriginRef.current || performance.now())),
      beforePageLoadingFalse: pageLoadingFalseAtRef.current == null,
    });
  }, [homeMetricsLoaded]);


  useEffect(() => {
    if (!invoiceAttachPaymentId) return;
    lockUiOverlay();
    return () => unlockUiOverlay();
  }, [invoiceAttachPaymentId]);

  useEffect(() => {
    const savedScanId = window.localStorage.getItem("activeGmailScanId");
    if (savedScanId) setActiveScanId(savedScanId);
  }, []);

  const refreshGmailStatus = useCallback(async () => {
    try {
      const status = await apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`);
      setGmailStatus(status);
      setGmailStatusKnown(true);
      setGmailStatusStale(false);
      if (status.connected) {
        setShowGmailConnect(false);
        setError("");
        setScanToast((current) => current?.type === "error" && current.text.includes("ג׳ימייל") ? null : current);
      }
      return status;
    } catch (refreshError) {
      setGmailStatusStale(true);
      if (!gmailStatus) {
        setGmailStatusKnown(false);
      }
      throw refreshError;
    }
  }, [gmailStatus]);

  const requestHomeMetrics = useCallback(async (autoRetry: boolean) => {
    setHomeMetricsError(false);
    let attempts = 0;
    const origin = fpDebugOriginRef.current || performance.now();
    try {
      const runOnce = async () => {
        attempts += 1;
        fpDebugLog("bootstrap_metrics_attempt", {
          attempt: attempts,
          autoRetry,
          beforePageLoadingFalse: pageLoadingFalseAtRef.current == null,
        });
        invalidateDashboardBootstrap();
        const { payload, cacheSource } = await loadDashboardBootstrap({ force: true });
        setHomeMetrics(payload.homeMetrics);
        setHomeMetricsLoaded(true);
        setRecentTasks(payload.tasksPreview.slice(0, 8));
        setOrganizationSettings(payload.organizationSettings);
        setOrganizationSettingsCache(payload.organizationSettings);
        setGmailStatus({
          googleConfigured: payload.gmailStatus.googleConfigured,
          connected: payload.gmailStatus.connected,
          connectedAt: payload.gmailStatus.connectedAt,
        });
        setGmailStatusKnown(true);
        setGmailStatusStale(false);
        fpDebugLog("bootstrap_end", {
          cacheSource,
          success: true,
          attempts,
          sinceMountMs: Math.round(performance.now() - origin),
          bootstrapNetworkCount: getDashboardBootstrapDebugCounters().networkCount,
        });
      };
      await timedFpRequest("bootstrap", pageLoadingFalseAtRef.current, origin, runOnce);
    } catch {
      if (autoRetry) {
        try {
          await new Promise((r) => setTimeout(r, 2500));
          invalidateDashboardBootstrap();
          const { payload, cacheSource } = await loadDashboardBootstrap({ force: true });
          setHomeMetrics(payload.homeMetrics);
          setHomeMetricsLoaded(true);
          setRecentTasks(payload.tasksPreview.slice(0, 8));
          setOrganizationSettings(payload.organizationSettings);
          setOrganizationSettingsCache(payload.organizationSettings);
          fpDebugLog("bootstrap_end", {
            cacheSource,
            success: true,
            attempts: attempts + 1,
            retry: true,
          });
          return;
        } catch {
          /* fall through */
        }
      }
      setHomeMetricsError(true);
      fpDebugLog("bootstrap_end", {
        success: false,
        attempts,
        beforePageLoadingFalse: pageLoadingFalseAtRef.current == null,
      });
    }
  }, []);

  const retryHomeMetrics = useCallback(() => {
    void requestHomeMetrics(false);
  }, [requestHomeMetrics]);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const isCurrent = () => loadGenerationRef.current === generation;
    let skipBackground = false;
    let firstPaintGmail = {
      nextStatus: gmailStatus,
      known: gmailStatusKnown,
      stale: gmailStatusStale,
    };

    try {
      const appointmentFrom = new Date().toISOString();
      const appointmentTo = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

      // M1: First Paint ≤4 light requests. Heavy lists/stats start only AFTER pageLoading=false.
      await runDashboardHomeLoadPhases({
        isCurrent,
        onFirstPaintReady: () => {
          if (isCurrent()) setPageLoading(false);
        },
        onBackgroundError: () => {
          // Background failures stay local — never flip pageLoading or wipe First Paint data.
        },
        loadFirstPaint: async () => {
          if (isDashboardFpDebugEnabled() && fpDebugOriginRef.current === 0) {
            fpDebugOriginRef.current = performance.now();
          }
          const origin = fpDebugOriginRef.current || performance.now();
          fpDebugLog("bootstrap_start", {
            sinceMountMs: 0,
            beforePageLoadingFalse: pageLoadingFalseAtRef.current == null,
          });

          try {
            const { payload, cacheSource } = await timedFpRequest(
              "bootstrap",
              pageLoadingFalseAtRef.current,
              origin,
              () => loadDashboardBootstrap()
            );

            if (!isCurrent()) return;

            const payloadBytes = (() => {
              try {
                return new TextEncoder().encode(JSON.stringify(payload)).length;
              } catch {
                return null;
              }
            })();

            fpDebugLog("bootstrap_end", {
              sinceMountMs: Math.round(performance.now() - origin),
              bootstrap_success: true,
              bootstrap_cache_source: cacheSource,
              bootstrapNetworkCount: getDashboardBootstrapDebugCounters().networkCount,
              payloadBytes,
              retryCount: getDashboardBootstrapDebugCounters().retryCount,
              beforePageLoadingFalse: pageLoadingFalseAtRef.current == null,
            });

            setHomeMetrics(payload.homeMetrics);
            setHomeMetricsLoaded(true);
            setHomeMetricsError(false);
            setRecentTasks(payload.tasksPreview.slice(0, 8));
            setOrganizationSettings(payload.organizationSettings);
            setOrganizationSettingsCache(payload.organizationSettings);

            const nextGmail: GmailStatus = {
              googleConfigured: payload.gmailStatus.googleConfigured,
              connected: payload.gmailStatus.connected,
              connectedAt: payload.gmailStatus.connectedAt,
            };
            firstPaintGmail = {
              nextStatus: nextGmail,
              known: true,
              stale: false,
            };
            setGmailStatus(nextGmail);
            setGmailStatusKnown(true);
            setGmailStatusStale(false);

            if (payload.organizationSettings.onboardingRequired) {
              skipBackground = true;
              router.replace("/onboarding");
              return;
            }

            const loadTruth = resolveGmailTruthAfterLoad({
              gmailResolved: firstPaintGmail,
              scanLogs: scanStatus?.logs,
              scanLast: scanStatus?.last ?? null,
              documentReviewCount: pendingDocumentReviewsCount,
            });
            setShowGmailConnect(loadTruth.showConnectCta);
            setError("");
          } catch (err) {
            if (!isCurrent()) return;
            fpDebugLog("bootstrap_end", {
              sinceMountMs: Math.round(performance.now() - origin),
              bootstrap_success: false,
              bootstrapNetworkCount: getDashboardBootstrapDebugCounters().networkCount,
              errorName: err instanceof Error ? err.name : "error",
              beforePageLoadingFalse: pageLoadingFalseAtRef.current == null,
            });
            // Miss failure: real error, never fake zero KPIs.
            setHomeMetricsError(true);
            setGmailStatusKnown(false);
            setGmailStatusStale(true);
            setError(err instanceof Error ? err.message : "Failed to load dashboard");
            if (isAuthError(err)) {
              clearToken();
              router.replace("/login");
            }
          }
        },
        loadBackground: async () => {
          if (!isCurrent() || skipBackground) return;
          if (isDashboardFpDebugEnabled()) {
            try {
              performance.mark("background_start");
            } catch {
              /* ignore */
            }
            fpDebugLog("background_start", {
              sinceMountMs: Math.round(
                performance.now() - (fpDebugOriginRef.current || performance.now())
              ),
              afterPageLoadingFalse: pageLoadingFalseAtRef.current != null,
            });
          }

          const [
            statsResult,
            reviewsResult,
            briefingResult,
            summaryResult,
            clientsResult,
            scanStatusResult,
            paymentsResult,
            missingResult,
            invoicesResult,
            alertsResult,
            systemResult,
            accountantResult,
          ] = await Promise.allSettled([
            apiFetch<DashboardStats>("/api/stats"),
            apiFetch<DocumentReviewsHomeSummaryResponse>(
              "/api/document-reviews?status=needs_review&view=summary"
            ),
            fetchBriefingSchedulingSnapshot(appointmentFrom, appointmentTo),
            apiFetch<{ text: string }>("/api/summary/daily"),
            apiFetch<ClientsResponse>("/api/clients"),
            apiFetch<ScanStatus>("/api/automation/scan-status"),
            apiFetch<Payment[]>("/api/payments"),
            apiFetch<{ invoices: RecentInvoice[] }>("/api/invoices?completeness=incomplete"),
            apiFetch<{ invoices: RecentInvoice[] }>("/api/invoices?completeness=complete"),
            apiFetch<AlertItem[]>("/api/alerts"),
            apiFetch<SystemHealth>("/api/system/health", { timeoutMs: 30000 }),
            apiFetch<AccountantSummary>("/api/accountant/summary"),
          ] as const);

          if (!isCurrent()) return;

          if (isDashboardFpDebugEnabled()) {
            fpDebugLog("background_stats_settled", {
              stats: statsResult.status,
              afterPageLoadingFalse: true,
            });
          }

          // Only apply fulfilled Background results — never clear First Paint / prior data on reject.
          if (statsResult.status === "fulfilled") setStats(statsResult.value);

          if (reviewsResult.status === "fulfilled") {
            setPendingDocumentReviewsCount(reviewsResult.value.count);
            setDocumentReviews(reviewsResult.value.items.slice(0, 5));
          }

          if (briefingResult.status === "fulfilled") {
            setBriefingScheduling(briefingResult.value);
            setUpcomingAppointments(
              briefingResult.value.upcoming.map((item) => ({
                id: item.id,
                startTime: item.startTime,
                status: item.status,
                client: { name: item.clientName },
                source: item.source,
                statusLabel: item.statusLabel,
                pendingOwnerApproval: item.pendingOwnerApproval,
              }))
            );
          }

          if (summaryResult.status === "fulfilled") setSummary(summaryResult.value.text);
          if (clientsResult.status === "fulfilled") setClients(clientsResult.value);

          if (scanStatusResult.status === "fulfilled") {
            setScanStatus(scanStatusResult.value);
            setScanStatusKnown(true);
            setScanStatusStale(false);
            const running = scanStatusResult.value.logs.find((log) => isAdoptableRunningScanLog(log));
            const trackedLog = activeScanId
              ? scanStatusResult.value.logs.find((log) => log.id === activeScanId)
              : null;

            if (trackedLog && isTerminalScanStatusLog(trackedLog)) {
              setActiveScanId(null);
              setActiveScan(null);
              setSyncing(false);
              syncingRef.current = false;
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
              syncingRef.current = false;
              setFirstScanRunning(false);
              setScanProgress([]);
              window.localStorage.removeItem("activeGmailScanId");
            }
          } else {
            const scanResolved = resolveScanStatusFromSettled(scanStatus, scanStatusResult);
            if (scanResolved.nextStatus) {
              setScanStatus(scanResolved.nextStatus);
            }
            setScanStatusKnown(scanResolved.known);
            setScanStatusStale(scanResolved.stale);
          }

          if (paymentsResult.status === "fulfilled") setPayments(paymentsResult.value);
          if (missingResult.status === "fulfilled") {
            setMissingInvoices(
              missingResult.value.invoices.map((invoice) => ({
                id: invoice.id,
                supplier: invoice.supplierName?.trim() || "ספק לא זוהה",
                amount: invoice.amount ?? 0,
                currency: invoice.currency ?? "ILS",
                date: invoice.date,
                dueDate: invoice.dueDate ?? null,
                paid: false,
                missingInvoice: true,
                paymentRequired: false,
                subject: invoice.description,
                documentLink: invoice.driveFileUrl ?? invoice.driveUrl ?? null,
                invoiceLink: invoice.driveFileUrl ?? invoice.driveUrl ?? null,
                emailSender: null,
              }))
            );
          }
          if (invoicesResult.status === "fulfilled") setRecentInvoices(invoicesResult.value.invoices);
          if (alertsResult.status === "fulfilled") setAlerts(alertsResult.value.slice(0, 8));

          const loadTruth = resolveGmailTruthAfterLoad({
            gmailResolved: firstPaintGmail,
            scanLogs:
              scanStatusResult.status === "fulfilled"
                ? scanStatusResult.value.logs
                : scanStatus?.logs,
            scanLast:
              scanStatusResult.status === "fulfilled"
                ? scanStatusResult.value.last
                : scanStatus?.last ?? null,
            documentReviewCount:
              reviewsResult.status === "fulfilled"
                ? reviewsResult.value.count
                : pendingDocumentReviewsCount,
          });
          setShowGmailConnect(loadTruth.showConnectCta);

          if (systemResult.status === "fulfilled") {
            setSystemHealth(systemResult.value);
            setSystemHealthFetchFailed(false);
          } else {
            setSystemHealthFetchFailed(true);
          }
          if (accountantResult.status === "fulfilled") setAccountantSummary(accountantResult.value);

          if (!isCurrent()) return;
          apiFetch<WhatsAppAssistantStats>("/api/whatsapp-assistant/stats")
            .then((statsValue) => {
              if (isCurrent()) setWhatsAppStats(statsValue);
            })
            .catch(() => undefined);
          setLastUpdatedAt(new Date());
        },
      });
    } catch (err) {
      if (!isCurrent()) return;
      if (isAuthError(err)) {
        clearToken();
        router.replace("/");
        return;
      }
      // First Paint catastrophic only — do not blank Background fields that may already be shown.
      setError(err instanceof Error ? err.message : "טעינת הדשבורד נכשלה");
    } finally {
      if (isCurrent()) setPageLoading(false);
    }
  }, [
    activeScanId,
    gmailStatus,
    pendingDocumentReviewsCount,
    requestHomeMetrics,
    router,
    scanStatus,
  ]);


  const loadRef = useRef(load);
  const refreshGmailStatusRef = useRef(refreshGmailStatus);
  loadRef.current = load;
  refreshGmailStatusRef.current = refreshGmailStatus;

  useEffect(() => {
    if (!getToken()) {
      router.replace("/");
      return;
    }

    const search = window.location.search;

    if (shouldHandleGmailOAuthErrorReturn({ search, alreadyHandled: gmailOAuthReturnHandledRef.current })) {
      gmailOAuthReturnHandledRef.current = true;
      const { status, reason } = parseGmailOAuthReturn(search);
      const cleanPath = cleanGmailOAuthReturnUrl();
      window.history.replaceState(null, "", cleanPath);
      router.replace(cleanPath);
      if (status) {
        setScanToast({ type: "error", text: gmailOAuthErrorMessage(reason, status) });
      }
      void loadRef.current();
    } else if (
      shouldHandleGmailOAuthReturn({
        search,
        alreadyHandled: gmailOAuthReturnHandledRef.current,
      })
    ) {
      gmailOAuthReturnHandledRef.current = true;
      const cleanPath = cleanGmailOAuthReturnUrl();
      window.history.replaceState(null, "", cleanPath);
      router.replace(cleanPath);

      setScanToast({ type: "success", text: "ג׳ימייל חובר בהצלחה" });
      setGmailStatus((current) => buildOptimisticGmailConnectedStatus(current));
      setGmailStatusKnown(true);
      setGmailStatusStale(false);
      setShowGmailConnect(false);

      void (async () => {
        try {
          await refreshGmailStatusRef.current();
          await loadRef.current();
          await delay(1200);
          await refreshGmailStatusRef.current();
        } catch {
          setGmailStatusStale(true);
          setScanToast({
            type: "warning",
            text: "ג׳ימייל חובר — מאמתים את החיבור...",
          });
        }
      })();
    } else {
      void loadRef.current();
    }

    const interval = window.setInterval(() => {
      loadRef.current().catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [router]);

  useEffect(() => {
    if (pageLoading || !firstVisitMode || autoFirstScanRef.current) return;
    if (!gmailStatus?.connected) return;
    if (activeScanId || syncing) {
      autoFirstScanRef.current = true;
      return;
    }
    const running = scanStatus?.logs?.some((log) => isRunningScanStatusLog(log));
    if (running) {
      autoFirstScanRef.current = true;
      return;
    }
    autoFirstScanRef.current = true;
    console.log("[dashboard] auto-start first gmail scan after onboarding");
    void runSync();
  }, [pageLoading, firstVisitMode, gmailStatus?.connected, activeScanId, syncing, scanStatus?.logs]);

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
    // P0: הלולאה חייבת גבולות — בלעדיהם ספינר "סורק..." יכול לרוץ לנצח
    let pollAttempts = 0;
    let consecutivePollFailures = 0;

    const abandonScanTracking = (toastText: string) => {
      setActiveScanId(null);
      setActiveScan(null);
      setSyncing(false);
      syncingRef.current = false;
      setFirstScanRunning(false);
      setScanProgress([]);
      setFirstScanPhase(null);
      window.localStorage.removeItem("activeGmailScanId");
      setScanToast({ type: "warning", text: toastText });
    };

    const completeActiveScan = async (progress: ScanProgressResult) => {
      setFirstScanRunning(false);
      setSyncing(false);
      syncingRef.current = false;
      setActiveScan(null);
      setActiveScanId(null);
      setScanProgress([]);
      setFirstScanPhase(null);
      window.localStorage.removeItem("activeGmailScanId");

      const found = scanDocumentsFound(progress);

      if (isSuccessfulGmailScanProgress(progress)) {
        setFirstScanSummary(formatProgressSummary(progress));
        if (firstVisitMode && found === 0) {
          setActionMessage(formatFirstScanEmptyMessage(progress.emailsFetched ?? 0));
          setScanToast({ type: "info", text: "הסריקה הסתיימה — לא נמצאו מסמכים להצגה בחודש האחרון." });
        } else {
          setScanToast({
            type: progress.status === "partial" ? "warning" : "success",
            text:
              progress.status === "partial"
                ? formatPartialScanMessage(progress)
                : "הסריקה הסתיימה והנתונים עודכנו",
          });
        }
      } else if (isPausedGmailScanStatus(progress.status)) {
        setScanToast({
          type: "warning",
          text: formatPartialScanMessage(progress),
        });
      } else {
        // לא מציגים errorMessage גולמי מהשרת (אנגלית/טכני) — הודעה בעברית לפי הסטטוס
        setScanToast({
          type: "error",
          text:
            progress.status === "timed_out" || progress.status === "stale"
              ? SCAN_STUCK_USER_MESSAGE_HE
              : progress.status === "cancelled"
                ? "הסריקה בוטלה. אפשר להריץ סריקה חדשה מתי שנוח לך."
                : progress.userMessageHe || "הסריקה נכשלה. אפשר לנסות שוב בעוד רגע.",
        });
      }

      if (firstVisitMode) {
        setFirstScanSettled(true);
      }

      invalidateDashboardBootstrap();
      await load();
    };

    const poll = async () => {
      pollAttempts += 1;
      if (pollAttempts > MAX_GMAIL_SCAN_POLL_ATTEMPTS) {
        // Hard 3-minute client bound — never keep "סורקת" without terminal backend proof.
        abandonScanTracking(SCAN_STUCK_USER_MESSAGE_HE);
        return;
      }
      try {
        const progress = await apiFetch<ScanProgressResult>(`/api/gmail/scan/${activeScanId}`);
        if (cancelled) return;
        consecutivePollFailures = 0;

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
        if (firstVisitMode) {
          setFirstScanPhase(phaseLabelForScanProgress(progress, syncing));
          setActionMessage(phaseLabelForScanProgress(progress, syncing));
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setActiveScanId(null);
            setActiveScan(null);
            setSyncing(false);
            syncingRef.current = false;
            setFirstScanRunning(false);
            setScanProgress([]);
            window.localStorage.removeItem("activeGmailScanId");
            invalidateDashboardBootstrap();
      await load();
            return;
          }
          // P0: שגיאות רצופות (5xx/רשת) לא ירדפו לנצח — אחרי 6 עוצרים את המעקב
          consecutivePollFailures += 1;
          if (consecutivePollFailures >= 6) {
            abandonScanTracking("איבדתי קשר עם סטטוס הסריקה — הפסקתי את המעקב. רענון הדף יציג את המצב העדכני.");
            return;
          }
          setScanToast({ type: "error", text: err instanceof Error ? err.message : "טעינת סטטוס סריקה נכשלה" });
        }
      }
    };

    poll().catch(() => undefined);
    const interval = window.setInterval(() => poll().catch(() => undefined), GMAIL_SCAN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeScanId, firstVisitMode, load, syncing]);

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
    if (connectingGmail) return;
    const token = getToken();
    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/dashboard?connect=gmail")}`);
      return;
    }

    try {
      setConnectingGmail(true);
      setError("");
      console.log("[dashboard] gmail oauth start returnTo=/dashboard");
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const returnTo = encodeURIComponent("/dashboard");
      const res = await fetch(`${apiUrl}/api/integrations/gmail/connect-url?returnTo=${returnTo}`, {
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
    } finally {
      setConnectingGmail(false);
    }
  }

  async function runSync() {
    if (syncingRef.current || syncing || activeScanId) {
      scrollToScanProgress();
      return;
    }
    console.log("[dashboard] gmail scan clicked");
    const freshGmailStatus = gmailStatus?.connected ? gmailStatus : await refreshGmailStatus().catch(() => gmailStatus);
    if (freshGmailStatus && !freshGmailStatus.connected) {
      const message = "יש לחבר חשבון ג׳ימייל לפני הסריקה";
      setShowGmailConnect(true);
      setError(message);
      setScanToast({ type: "error", text: message });
      return;
    }

    syncingRef.current = true;
    setSyncing(true);
    setError("");
    if (firstVisitMode) {
      const preparing = "מתחברת לג׳ימייל ומכינה את הסריקה...";
      setFirstScanPhase(preparing);
      setActionMessage(preparing);
    }
    setScanToast({ type: "info", text: "סורק ג׳ימייל ומחפש חשבוניות, קבלות ודרישות תשלום..." });
    const retryRequest = createDashboardSyncRetryRequest();
    try {
      const result = await apiFetch<GmailScanResult>(retryRequest.path, { method: retryRequest.method });
      if (result.scanId) {
        setActiveScanId(result.scanId);
        window.localStorage.setItem("activeGmailScanId", result.scanId);
        const message = result.inProgress ? "סריקת המיילים מתבצעת כעת..." : "סריקת ג׳ימייל התחילה ברקע.";
        setScanToast({ type: "info", text: message });
        return;
      }
      invalidateDashboardBootstrap();
      await load();
      const summary = scanSummaryFromResult(result);
      const message = result.message ?? (result.backgroundProcessing ? `נמצאו ${summary.emailsScanned} מיילים בג׳ימייל. העיבוד המלא ממשיך ברקע ויעדכן חשבוניות/תשלומים.` : formatScanSuccess(summary));
      setScanToast({ type: "success", text: message });
    } catch (e) {
      const message = e instanceof Error ? e.message : "סריקת ג׳ימייל נכשלה";
      console.warn("[dashboard] gmail scan failed:", message);
      setError(message);
      setScanToast({ type: "error", text: message });
      if (message.includes("Gmail") || message.includes("ג׳ימייל") || message.includes("הרשאות") || message.includes("מחובר")) {
        setShowGmailConnect(true);
      }
      if (firstVisitMode) {
        setFirstScanSettled(true);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  async function scanAllClients() {
    if (syncingRef.current || syncing) return;
    syncingRef.current = true;
    setSyncing(true);
    setError("");
    try {
      const result = await apiFetch<{ success: boolean; results?: Array<{ message?: string }> }>("/api/clients/scan-all", { method: "POST" });
      invalidateDashboardBootstrap();
      await load();
      setActionMessage(result.results?.find((item) => item.message)?.message ?? "סריקת כל הלקוחות הסתיימה");
    } catch (e) {
      setError(e instanceof Error ? e.message : "סריקת לקוחות נכשלה");
    } finally {
      syncingRef.current = false;
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
        invalidateDashboardBootstrap();
      await load();
        return;
      }
      setScanToast({
        type: result.status === "completed" ? "success" : "error",
        text: result.status === "completed" ? `סריקת וואטסאפ הסתיימה: ${result.messagesScanned} הודעות נסרקו` : `סריקת וואטסאפ הסתיימה עם ${result.errorsCount} שגיאות`,
      });
      invalidateDashboardBootstrap();
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
    if (paymentActionInFlightRef.current) return;
    paymentActionInFlightRef.current = true;
    setActionMessage("");
    try {
      await apiFetch(`/api/payments/${paymentId}`, { method: "PATCH", body: JSON.stringify({ paid: true }) });
      invalidateDashboardBootstrap();
      await load();
      setActionMessage("התשלום סומן כשולם");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "עדכון תשלום נכשל");
    } finally {
      paymentActionInFlightRef.current = false;
    }
  }

  function attachInvoiceToPayment(paymentId: string) {
    setInvoiceAttachPaymentId(paymentId);
    setInvoiceAttachLink("");
  }



  async function submitInvoiceAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceAttachPaymentId || !invoiceAttachLink.trim()) return;
    if (invoiceAttachInFlightRef.current) return;
    invoiceAttachInFlightRef.current = true;
    setActionMessage("");
    try {
      await apiFetch(`/api/payments/${invoiceAttachPaymentId}`, { method: "PATCH", body: JSON.stringify({ invoiceLink: invoiceAttachLink.trim() }) });
      invalidateDashboardBootstrap();
      await load();
      setActionMessage("החשבונית צורפה לתשלום");
      setInvoiceAttachPaymentId(null);
      setInvoiceAttachLink("");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "צירוף חשבונית נכשל");
    } finally {
      invoiceAttachInFlightRef.current = false;
    }
  }


  const viewModel = useMemo(
    () =>
      buildDashboardHomeViewModel({
        pageLoading,
        gmailStatus,
        gmailStatusKnown,
        gmailStatusStale,
        scanStatus,
        scanStatusKnown,
        scanStatusStale,
        documentReviews,
        pendingDocumentReviewsCount,
        activeScan,
        activeScanId,
        error,
        actionMessage,
        scanToast,
        syncing,
        firstScanPhase,
        scanProgress,
        connectingGmail,
        showGmailConnect,
        systemHealth,
        organizationSettings,
        payments,
        missingInvoices,
        alerts,
        upcomingAppointments,
        briefingScheduling,
        stats,
        recentTasks,
        recentInvoices,
        whatsAppStats,
        firstVisitMode,
        clientMounted,
        systemHealthFetchFailed,
      }),
    [
      pageLoading,
      gmailStatus,
      gmailStatusKnown,
      gmailStatusStale,
      scanStatus,
      scanStatusKnown,
      scanStatusStale,
      documentReviews,
      pendingDocumentReviewsCount,
      activeScan,
      activeScanId,
      error,
      actionMessage,
      scanToast,
      syncing,
      firstScanPhase,
      scanProgress,
      connectingGmail,
      showGmailConnect,
      systemHealth,
      organizationSettings,
      payments,
      missingInvoices,
      alerts,
      upcomingAppointments,
      briefingScheduling,
      stats,
      recentTasks,
      recentInvoices,
      whatsAppStats,
      firstVisitMode,
      clientMounted,
      systemHealthFetchFailed,
    ]
  );

  const {
    gmailConnection,
    gmailApiConnected,
    dashboardSyncState,
    heroTrust,
    pageError,
    displayActionMessage,
    displayToast,
    businessName,
    gmailIntegrationModel,
    decisionItems,
    natalieRecommendation,
    heroBriefing,
    alreadyWorkedSummary,
    morningGreeting,
    yourDayItems,
    smartSuggestions,
    snapshotMetrics,
    activityTimeline,
  } = viewModel;

  useEffect(() => {
    if (pageLoading || !gmailStatusKnown) return;
    setShowGmailConnect(gmailConnection.showConnectCta);
  }, [pageLoading, gmailStatusKnown, gmailConnection.showConnectCta]);

  useEffect(() => {
    if (connectGmailTriggeredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (
      !shouldAutoTriggerGmailConnect({
        connectParam: params.get("connect"),
        pageLoading,
        alreadyTriggered: connectGmailTriggeredRef.current,
        gmailConnectionPhase: gmailConnection.phase,
      })
    ) {
      return;
    }
    connectGmailTriggeredRef.current = true;
    router.replace("/dashboard");
    console.log("[dashboard] auto-trigger gmail connect from ?connect=gmail");
    void connectGmail();
  }, [pageLoading, gmailConnection.phase, router]);

  const whatsAppConnected = Boolean(systemHealth?.components.whatsapp.connected);



  const gmailCardActions = useMemo(
    () => {
      if (!gmailStatusKnown || gmailConnection.phase === "unknown" || gmailConnection.phase === "evidence_ambiguous") {
        return [];
      }
      if (gmailConnection.phase === "disconnected") {
        return [
          { id: "connect", label: "חבר ג׳ימייל", onClick: () => void connectGmail(), disabled: connectingGmail || syncing, priority: "primary" as const },
        ];
      }
      return [
        { id: "scan", label: "סרוק עכשיו", onClick: () => void runSync(), disabled: syncing, priority: "primary" as const },
        { id: "manage", label: "נהל חיבור", onClick: () => router.push("/dashboard/settings") },
        { id: "reconnect", label: "התחבר מחדש", onClick: () => void connectGmail(), disabled: connectingGmail },
        { id: "disconnect", label: "נתק ג׳ימייל", onClick: () => router.push("/dashboard/settings") },
      ];
    },
    [gmailStatusKnown, gmailConnection.phase, connectingGmail, syncing, router]
  );


  const scrollToDecisions = useCallback(() => {
    document.getElementById("natalie-decisions")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToScanProgress = useCallback(() => {
    document.getElementById("gmail-scan-progress")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleHeroCta = useCallback(() => {
    switch (heroBriefing.ctaIntent) {
      case "connect_gmail":
        void connectGmail();
        return;
      case "run_scan":
        void runSync();
        return;
      case "navigate":
        if (natalieRecommendation.href) {
          router.push(natalieRecommendation.href);
          return;
        }
        break;
      case "ask_natalie":
      default:
        break;
    }
    if (natalieRecommendation.scrollToDecisions || decisionItems.length > 0) {
      scrollToDecisions();
      return;
    }
    document.getElementById("natalie-command")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [
    heroBriefing.ctaIntent,
    natalieRecommendation.href,
    natalieRecommendation.scrollToDecisions,
    decisionItems.length,
    scrollToDecisions,
    router,
    runSync,
  ]);

  useEffect(() => {
    if (dashboardSyncState.status === "ERROR" && scanToast?.type === "success") {
      setScanToast(null);
    }
  }, [dashboardSyncState.status, scanToast]);

  // התאוששות: אין סריקה פעילה והמצב חזר לתקין — טוסט שגיאה ישן לא נשאר על המסך
  useEffect(() => {
    if (scanToast?.type !== "error") return;
    if (activeScanId || syncing) return;
    if (dashboardSyncState.status !== "CONNECTED") return;
    setScanToast(null);
  }, [scanToast, activeScanId, syncing, dashboardSyncState.status]);

  useEffect(() => {
    if (!scanToast || scanToast.type !== "success" || !dashboardSyncState.allowsSuccessToast) return;
    const timeout = window.setTimeout(() => setScanToast(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [scanToast, dashboardSyncState.allowsSuccessToast]);

  const handleNatalieConversation = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (trimmed.includes("דחוף") || trimmed.includes("מה חשוב")) {
        scrollToDecisions();
        return;
      }
      if (trimmed.includes("תשלום") || trimmed.includes("שולם") || trimmed.includes("פתוח")) {
        router.push("/payments");
        return;
      }
      if (trimmed.includes("משימה") || trimmed.includes("משימות")) {
        router.push("/tasks");
        return;
      }
      if (trimmed.includes("פגישה") || trimmed.includes("יומן") || trimmed.includes("קבע")) {
        router.push("/dashboard/calendar");
        return;
      }
      if (trimmed.includes("רואה החשבון") || trimmed.includes("חודש לרואה")) {
        router.push("/dashboard/accountant");
        return;
      }
      if (trimmed.includes("מגיע היום") || trimmed.includes("מי מגיע")) {
        router.push("/dashboard/calendar");
        return;
      }
      if (trimmed.includes("מה מחכה") || trimmed.includes("לאישור")) {
        router.push("/dashboard/document-reviews");
        return;
      }
      if (conversationRequestsScanProgress(trimmed)) {
        scrollToScanProgress();
        return;
      }
      if (conversationRequestsGmailScan(trimmed)) {
        void runSync();
        return;
      }
      setActionMessage("קיבלתי. נטלי מטפלת בזה — אפשר גם לדבר איתי דרך כפתור נטלי.");
    },
    [router, scrollToDecisions, scrollToScanProgress, runSync]
  );


  const businessModule = useMemo(
    () => getBusinessModule(organizationSettings?.businessType),
    [organizationSettings?.businessType]
  );

  const homeMetricsSnapshot = useMemo(
    () => snapshotFromHomeMetrics(homeMetrics),
    [homeMetrics]
  );

  const unreadAlertsCount = useMemo(() => {
    if (!homeMetricsLoaded) return null;
    const value = homeMetrics?.metrics.unread_alerts;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }, [homeMetricsLoaded, homeMetrics]);

  return {
    router,
    stats,
    summary,
    clients,
    scanStatus,
    payments,
    missingInvoices,
    recentInvoices,
    recentTasks,
    alerts,
    documentReviews,
    pendingDocumentReviewsCount,
    upcomingAppointments,
    pageLoading,
    firstScanPhase,
    invoiceAttachPaymentId,
    invoiceAttachLink,
    setInvoiceAttachLink,
    setInvoiceAttachPaymentId,
    clientMounted,
    lastUpdatedAt,
    syncing,
    systemHealth,
    systemChecking,
    showSystemCheck,
    whatsAppConnected,
    whatsAppScanRange,
    setWhatsAppScanRange,
    whatsAppScanning,
    whatsAppScanResult,
    whatsAppStats,
    pageError,
    displayActionMessage,
    displayToast,
    businessName,
    businessModule,
    homeMetricsSnapshot,
    homeMetricsLoaded,
    homeMetricsError,
    retryHomeMetrics,
    unreadAlertsCount,
    heroTrust,
    heroBriefing,
    dashboardSyncState,
    morningGreeting,
    alreadyWorkedSummary,
    yourDayItems,
    snapshotMetrics,
    smartSuggestions,
    activityTimeline,
    gmailIntegrationModel,
    gmailCardActions,
    gmailConnection,
    gmailApiConnected,
    handleHeroCta,
    handleNatalieConversation,
    connectGmail,
    runSync,
    scanAllClients,
    runSystemCheck,
    runWhatsAppScan,
    markPaymentPaid,
    attachInvoiceToPayment,
    submitInvoiceAttachment,
  };
}

