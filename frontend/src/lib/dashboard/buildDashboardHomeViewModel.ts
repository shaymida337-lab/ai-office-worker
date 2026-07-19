import { resolveNatalieRecommendation } from "@/lib/natalie/recommendation";
import { buildDecisionItems } from "@/lib/dashboard/decisions";
import { buildRecentActivityTimeline } from "@/lib/dashboard/home";
import type { NatalieRecommendationInput } from "@/lib/natalie/types";
import {
  mapBriefingToAppointmentInputs,
  type BriefingSchedulingSnapshot,
} from "@/lib/scheduling/briefing";
import type { DashboardStats, GmailStatus, Payment, Task } from "@/lib/api";
import { labelFor } from "@/lib/labels";
import {
  buildScanBannerState,
  isScanFailureStillRelevant,
  resolveDashboardGmailScanRunning,
} from "@/lib/gmailScanBanner";
import {
  hasGmailScanBacklog,
  normalizeScanStatusFromLog,
} from "@/lib/gmailScanLifecycle";
import type { OrganizationSettings } from "@/lib/business-config";
import { buildGmailIntegrationStatus, type IntegrationStatusModel } from "@/lib/integrations/integrationStatus";
import { resolveGmailConnectionTruth, hasGmailActivityEvidence } from "@/lib/integrations/gmailConnectionTruth";
import {
  resolveDashboardSyncState,
  resolveGmailConnectionCanonicalState,
  isSyncRelatedDashboardMessage,
  type DashboardSyncState,
} from "@/lib/dashboard/dashboardSyncState";
import { buildDashboardSyncSurfaces } from "@/lib/dashboard/dashboardSyncPresentation";
import { buildMorningGreeting } from "@/lib/dashboard/morningBrief";
import { buildAlreadyWorkedSummary } from "@/lib/dashboard/alreadyWorked";
import { buildYourDayItems } from "@/lib/dashboard/yourDay";
import { buildSnapshotMetrics, resolveOpenTasksCount } from "@/lib/dashboard/dashboardMetrics";
import { buildSmartSuggestions, isMonthEndApproaching } from "@/lib/dashboard/smartSuggestions";
import { buildHeroBriefing, type HeroBriefing } from "./heroBriefing";
import type { HeroTrustState } from "./heroTrust";
import type {
  AlertItem,
  DocumentReview,
  RecentInvoice,
  ScanProgressResult,
  ScanStatus,
  ScanToast,
  SystemHealth,
  UpcomingAppointment,
  WhatsAppAssistantStats,
} from "./homePageTypes";
import {
  formatDurationFromRange,
  formatShekel,
  isThisMonth,
  isTodayValue,
  resolveWorkspaceDisplayName,
} from "./homePageHelpers";

export type BuildDashboardHomeViewModelInput = {
  pageLoading: boolean;
  gmailStatus: GmailStatus | null;
  gmailStatusKnown: boolean;
  gmailStatusStale: boolean;
  scanStatus: ScanStatus | null;
  scanStatusKnown: boolean;
  scanStatusStale: boolean;
  documentReviews: DocumentReview[];
  activeScan: ScanProgressResult | null;
  activeScanId: string | null;
  error: string;
  actionMessage: string;
  scanToast: ScanToast | null;
  syncing: boolean;
  firstScanPhase: string | null;
  scanProgress: string[];
  connectingGmail: boolean;
  showGmailConnect: boolean;
  systemHealth: SystemHealth | null;
  organizationSettings: OrganizationSettings | null;
  payments: Payment[];
  missingInvoices: Payment[];
  alerts: AlertItem[];
  upcomingAppointments: UpcomingAppointment[];
  briefingScheduling: BriefingSchedulingSnapshot | null;
  stats: DashboardStats | null;
  recentTasks: Task[];
  recentInvoices: RecentInvoice[];
  whatsAppStats: WhatsAppAssistantStats | null;
  firstVisitMode: boolean;
  clientMounted?: boolean;
  systemHealthFetchFailed?: boolean;
};

export type DashboardHomeViewModel = {
  gmailConnection: ReturnType<typeof resolveGmailConnectionTruth>;
  gmailApiConnected: boolean;
  scanRunning: boolean;
  scanBacklog: boolean;
  scanStale: boolean;
  dashboardSyncState: DashboardSyncState;
  heroTrust: HeroTrustState;
  dashboardSurfaces: ReturnType<typeof buildDashboardSyncSurfaces>;
  pageError: string;
  displayActionMessage: string;
  displayToast: ScanToast | null;
  businessName: string;
  gmailIntegrationModel: IntegrationStatusModel;
  decisionItems: ReturnType<typeof buildDecisionItems>;
  natalieRecommendation: ReturnType<typeof resolveNatalieRecommendation>;
  heroBriefing: HeroBriefing;
  alreadyWorkedSummary: ReturnType<typeof buildAlreadyWorkedSummary>;
  morningGreeting: ReturnType<typeof buildMorningGreeting>;
  yourDayItems: ReturnType<typeof buildYourDayItems>;
  smartSuggestions: ReturnType<typeof buildSmartSuggestions>;
  snapshotMetrics: Array<{ id: string; label: string; value: string }>;
  activityTimeline: ReturnType<typeof buildRecentActivityTimeline>;
  openTasksCount: number;
  unpaidPayments: Payment[];
};

// כשל ישן ב-scan-status לא גורר מצב ERROR — רק כשל טרי נחשב מצב נוכחי
function resolveLastScanStatusForSync(last: ScanStatus["last"] | null): string | null {
  if (!last) return null;
  const normalized = last.status?.toLowerCase() ?? "";
  if ((normalized === "failed" || normalized === "error") && !isScanFailureStillRelevant(last)) {
    return null;
  }
  return last.status ?? null;
}

export function buildDashboardHomeViewModel(input: BuildDashboardHomeViewModelInput): DashboardHomeViewModel {
  const {
    pageLoading,
    gmailStatus,
    gmailStatusKnown,
    gmailStatusStale,
    scanStatus,
    scanStatusKnown,
    scanStatusStale,
    documentReviews,
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
    clientMounted = false,
    systemHealthFetchFailed = false,
  } = input;

  const clockReady = clientMounted && !pageLoading;
  const isToday = (value: string) => clockReady && isTodayValue(value);

  const gmailApiConnected = Boolean(gmailStatus?.connected);
  const gmailActivityEvidence = hasGmailActivityEvidence({
    scanLogs: scanStatus?.logs,
    scanLast: scanStatus?.last,
    documentReviewCount: documentReviews.length,
    extractedDocuments: activeScan?.documentsFound ?? scanStatus?.last?.saved ?? null,
  });
  const gmailConnection = resolveGmailConnectionTruth({
    pageLoading,
    statusKnown: gmailStatusKnown,
    statusStale: gmailStatusStale,
    apiConnected: gmailApiConnected,
    connectedAt: gmailStatus?.connectedAt,
    hasGmailActivityEvidence: gmailActivityEvidence,
  });

  // Same source as GlobalHeader workspace/user label — never prefer a separate settings.name nickname.
  const workspaceDisplayName = resolveWorkspaceDisplayName(organizationSettings);
  const ownerFirstName = workspaceDisplayName === "העסק שלי" ? null : workspaceDisplayName;
  const scanBanner = buildScanBannerState(activeScan, scanStatus);
  const scanStale = scanBanner?.status === "stale";
  const monthPayments = payments.filter((payment) => isThisMonth(payment.date));
  const unpaidPayments = payments.filter((payment) => !payment.paid);
  const openTasksCount = resolveOpenTasksCount(stats);
  const scanRunning = resolveDashboardGmailScanRunning({
    syncing,
    activeScanId,
    activeScan,
    scanBanner,
    scanLogs: scanStatus?.logs,
  });
  const scanBacklog = scanStatus?.last ? hasGmailScanBacklog(scanStatus.last) : false;
  const syncingPhase = firstScanPhase ?? scanProgress[scanProgress.length - 1] ?? null;
  const gmailConnectionCanonical = resolveGmailConnectionCanonicalState({
    phase: gmailConnection.phase,
    reconnectRequired: Boolean(gmailStatus?.reconnectRequired),
    connecting: connectingGmail,
    statusKnown: gmailStatusKnown,
  });
  const successfulScanLog =
    (scanStatus?.logs ?? []).find((log) => {
      const normalized = normalizeScanStatusFromLog(log.status, "running");
      return normalized === "success" || normalized === "partial";
    }) ?? null;
  const dashboardSyncState = resolveDashboardSyncState({
    gmailConnectionState: gmailConnectionCanonical,
    gmailStatusKnown,
    gmailStatusStale,
    scanStatusKnown,
    scanStatusStale,
    scanRunning,
    scanBanner,
    scanBacklog,
    lastScanStatus: resolveLastScanStatusForSync(scanStatus?.last ?? null),
    transientToast: scanToast,
    syncingPhase,
    gmailConnected: gmailConnection.treatAsConnectedForUi,
    missingDriveScopes: gmailStatus?.missingDriveScopes ?? [],
    lastSuccessfulScanAt: successfulScanLog?.endedAt ?? null,
    lastSyncAt: scanStatus?.last?.endedAt ?? null,
    scannedEmails: activeScan?.emailsFetched ?? scanStatus?.last?.found ?? null,
    extractedDocuments: activeScan?.documentsFound ?? scanStatus?.last?.saved ?? null,
    backendHealthy: systemHealth ? systemHealth.allPassed : undefined,
    backendHealthFetchFailed: systemHealthFetchFailed,
    clockReady,
  });
  const heroTrust = dashboardSyncState.heroTrust;
  const dashboardSurfaces = buildDashboardSyncSurfaces(dashboardSyncState, {
    pageError: error && !isSyncRelatedDashboardMessage(error) ? error : "",
    actionMessage,
  });
  const { error: pageError, actionMessage: displayActionMessage, toast: displayToast } = dashboardSurfaces.messageStack;
  const gmailStatusWithOptional = gmailStatus as (GmailStatus & {
    connectedEmail?: string | null;
    accountEmail?: string | null;
    email?: string | null;
  }) | null;
  const connectedGmailAddress = gmailStatusWithOptional?.googleAccountEmail
    ?? gmailStatusWithOptional?.connectedEmail
    ?? gmailStatusWithOptional?.accountEmail
    ?? gmailStatusWithOptional?.email
    ?? null;
  const scanStatusLabel = activeScan
    ? labelFor("scanStatus", activeScan.status)
    : scanStatus?.last
      ? labelFor("scanStatus", scanStatus.last.status)
      : "לא התחיל";
  const businessName = workspaceDisplayName;
  const gmailIntegrationModel = buildGmailIntegrationStatus({
    statusKnown: gmailStatusKnown,
    statusStale: gmailStatusStale,
    connected: gmailConnection.phase === "connected",
    connectionAmbiguous: gmailConnection.phase === "evidence_ambiguous",
    connecting: connectingGmail,
    scanRunning,
    hasWarning: dashboardSyncState.integrationHasWarning,
    hasError: dashboardSyncState.integrationHasError,
    reconnectRequired: Boolean(gmailStatus?.reconnectRequired),
    missingDriveScopes: gmailStatus?.missingDriveScopes ?? [],
    syncMessage: dashboardSyncState.message,
    gmailAddress: connectedGmailAddress,
    organizationName: businessName,
    lastSuccessfulScanAt: successfulScanLog?.endedAt ?? null,
    lastSyncAt: scanStatus?.last?.endedAt ?? null,
    scannedEmails: activeScan?.emailsFetched ?? scanStatus?.last?.found ?? null,
    extractedDocuments: activeScan?.documentsFound ?? scanStatus?.last?.saved ?? null,
    scanStatusLabel,
    connectedSince: gmailStatus?.connectedAt ?? null,
    scopesSummary: gmailStatus?.missingDriveScopes?.length
      ? `חסרים: ${gmailStatus.missingDriveScopes.join(", ")}`
      : "gmail.readonly, drive.file",
    lastOauthAt: gmailStatus?.connectedAt ?? null,
    lastScanDurationLabel: formatDurationFromRange(successfulScanLog?.startedAt ?? null, successfulScanLog?.endedAt ?? null),
    lastSyncDurationLabel: formatDurationFromRange(scanStatus?.last?.startedAt ?? null, scanStatus?.last?.endedAt ?? null),
  });
  const decisionItems = buildDecisionItems(
    documentReviews,
    missingInvoices,
    payments,
    alerts,
    upcomingAppointments.map((appt) => ({
      id: appt.id,
      clientName: appt.client.name,
      startTime: appt.startTime,
      status: appt.status,
      source: appt.source,
      pendingOwnerApproval: appt.pendingOwnerApproval,
    })),
    briefingScheduling?.pendingDecisions ?? []
  );
  const recommendationInput: NatalieRecommendationInput = {
    gmailConnected: gmailConnection.phase !== "disconnected",
    scanRunning,
    scanStale,
    scanBacklog,
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
      amount: payment.amount,
      currency: payment.currency,
      date: payment.date,
    })),
    missingInvoices: missingInvoices.map((payment) => ({
      id: payment.id,
      supplier: payment.supplier,
      paid: payment.paid,
      missingInvoice: true,
      amount: payment.amount,
      currency: payment.currency,
      date: payment.date,
    })),
    upcomingAppointments: mapBriefingToAppointmentInputs(
      briefingScheduling ?? {
        engineReadEnabled: false,
        upcoming: upcomingAppointments.map((appt) => ({
          id: appt.id,
          source: appt.source ?? "appointment",
          clientName: appt.client.name,
          startTime: appt.startTime,
          durationMinutes: 30,
          status: appt.status,
          statusLabel: appt.statusLabel ?? appt.status,
          pendingOwnerApproval: appt.pendingOwnerApproval ?? appt.status === "pending",
        })),
        pendingDecisions: [],
        todaySummary: {
          upcomingCount: upcomingAppointments.length,
          pendingDecisionCount: 0,
          todayCompletedCount: 0,
          todayNoShowCount: 0,
          todayCancelledCount: 0,
        },
      }
    ),
    pendingSchedulingDecisions: briefingScheduling?.pendingDecisions ?? [],
    openTasksCount,
    invoicesSaved: monthPayments.length,
    paymentsPrepared: unpaidPayments.length,
    pendingDecisionCount: decisionItems.length,
  };
  const natalieRecommendation = resolveNatalieRecommendation(recommendationInput);

  const lastScanToday =
    scanStatus?.last?.endedAt && isToday(scanStatus.last.endedAt) ? scanStatus.last : null;
  const alreadyWorkedSummary = buildAlreadyWorkedSummary({
    gmailConnected: gmailConnection.phase !== "disconnected",
    scanRunning,
    emailsScanned: lastScanToday?.found ?? activeScan?.emailsFetched,
    invoicesFound: lastScanToday?.invoicesFound ?? activeScan?.invoicesFound,
    paymentsUpdated: clockReady ? payments.filter((payment) => payment.paid && isTodayValue(payment.date)).length : 0,
    appointmentsSet: clockReady ? upcomingAppointments.filter((appt) => isTodayValue(appt.startTime)).length : 0,
    tasksCreated: clockReady ? recentTasks.filter((task) => isTodayValue(task.updatedAt)).length : 0,
    newDocuments: documentReviews.length,
  });

  const yourDayItems = buildYourDayItems({
    upcomingAppointments: upcomingAppointments.map((appt) => ({
      id: appt.id,
      startTime: appt.startTime,
      clientName: appt.client.name,
    })),
    pendingDocuments: documentReviews.length > 0 ? documentReviews.length : 0,
    pendingPayments: stats?.upcomingPaymentsCount ?? 0,
    overduePayments: stats?.overdueSupplierPayments ?? 0,
    openTasks: openTasksCount,
  });

  const morningGreeting = buildMorningGreeting({
    ownerFirstName,
    returningUser: !firstVisitMode && !pageLoading,
    hasWorkToday: decisionItems.length > 0 || yourDayItems.some((item) => item.urgency !== "calm"),
    clockReady,
  });

  const heroBriefing = buildHeroBriefing({
    recommendation: natalieRecommendation,
    scanRunning,
    gmailConnected: gmailConnection.phase !== "disconnected",
    firstVisitMode,
    pendingDecisionCount: decisionItems.length,
    ownerFirstName,
  });

  const smartSuggestions = buildSmartSuggestions({
    gmailConnectionPhase: gmailConnection.phase,
    gmailConnected: gmailApiConnected,
    scanRunning,
    hasAppointmentsToday: clockReady && upcomingAppointments.some((appt) => isTodayValue(appt.startTime)),
    pendingPayments: unpaidPayments.length,
    pendingDocuments: documentReviews.length,
    monthEndApproaching: clockReady ? isMonthEndApproaching() : false,
  });

  const snapshotMetrics = buildSnapshotMetrics({ stats, pageLoading });

  const activityTimeline = buildRecentActivityTimeline({
    scanLogs: scanStatus?.logs,
    recentInvoices: recentInvoices.slice(0, 5).map((invoice) => ({
      id: invoice.id,
      date: invoice.date,
      client: invoice.client,
      amount: invoice.amount ?? 0,
    })),
    paidPayments: payments.map((payment) => ({
      id: payment.id,
      supplier: payment.supplier,
      date: payment.date,
      paid: payment.paid,
    })),
    appointments: upcomingAppointments.map((appt) => ({
      id: appt.id,
      startTime: appt.startTime,
      clientName: appt.client.name,
      status: appt.status,
    })),
    remindersSentToday: whatsAppStats?.sentToday,
  });

  return {
    gmailConnection,
    gmailApiConnected,
    scanRunning,
    scanBacklog,
    scanStale,
    dashboardSyncState,
    heroTrust,
    dashboardSurfaces,
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
    openTasksCount,
    unpaidPayments,
  };
}
