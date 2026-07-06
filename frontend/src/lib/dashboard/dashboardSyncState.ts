import type { GmailConnectionPhase } from "@/lib/integrations/gmailConnectionTruth";
import type { ScanBannerState } from "@/lib/gmailScanBanner";
import { resolveConfirmedSyncIssue } from "./scanStatusTruth";
import type { HeroStatusTone, HeroTrustState } from "./heroTrust";

export type GmailConnectionCanonicalState =
  | "Checking"
  | "Connecting"
  | "Connected"
  | "Disconnected"
  | "ReconnectRequired";

export function resolveGmailConnectionCanonicalState(input: {
  phase: GmailConnectionPhase;
  reconnectRequired: boolean;
  connecting: boolean;
  statusKnown: boolean;
}): GmailConnectionCanonicalState {
  if (input.connecting) return "Connecting";
  if (!input.statusKnown || input.phase === "unknown" || input.phase === "evidence_ambiguous") {
    return "Checking";
  }
  if (input.phase === "disconnected") return "Disconnected";
  if (input.reconnectRequired) return "ReconnectRequired";
  if (input.phase === "connected") return "Connected";
  return "Checking";
}

export type DashboardSyncStatus = "CONNECTED" | "SYNCING" | "WARNING" | "ERROR" | "CHECKING";

export type DashboardSyncToast = {
  type: "success" | "error" | "warning" | "info";
  text: string;
};

export type DashboardHealthRow = {
  key: string;
  label: string;
  value: string;
};

export type DashboardSyncState = {
  status: DashboardSyncStatus;
  headline: string;
  message: string;
  reason: string | null;
  tone: HeroStatusTone;
  syncingLabel: string | null;
  showScanBanner: boolean;
  scanBanner: ScanBannerState | null;
  displayToast: DashboardSyncToast | null;
  displayError: string | null;
  heroTrust: HeroTrustState;
  healthRows: DashboardHealthRow[];
  integrationHasWarning: boolean;
  integrationHasError: boolean;
  allowsSuccessToast: boolean;
};

export type DashboardSyncStateInput = {
  gmailConnectionState: GmailConnectionCanonicalState;
  gmailStatusKnown?: boolean;
  gmailStatusStale?: boolean;
  scanStatusKnown?: boolean;
  scanStatusStale?: boolean;
  scanRunning: boolean;
  scanBanner: ScanBannerState | null;
  scanBacklog: boolean;
  lastScanStatus?: string | null;
  backendError?: string | null;
  transientToast?: DashboardSyncToast | null;
  syncingPhase?: string | null;
  gmailConnected: boolean;
  missingDriveScopes?: string[];
  lastSuccessfulScanAt?: string | null;
  lastSyncAt?: string | null;
  scannedEmails?: number | null;
  extractedDocuments?: number | null;
  aiHealthy?: boolean;
  backendHealthy?: boolean;
  backendHealthFetchFailed?: boolean;
  clockReady?: boolean;
};

function isCheckingState(input: DashboardSyncStateInput): boolean {
  if (input.gmailConnectionState === "Checking") {
    return true;
  }
  return input.gmailConnectionState === "Connected" && input.scanStatusKnown === false;
}

function resolveErrorReason(input: DashboardSyncStateInput): string | null {
  if (input.gmailConnectionState === "Disconnected") {
    return "Gmail לא מחובר";
  }
  if (input.gmailConnectionState === "ReconnectRequired") {
    return "נדרש חיבור מחדש ל-Gmail (OAuth פג תוקף או הרשאות)";
  }
  if (input.scanBanner?.status === "error") {
    return "הסריקה האחרונה נכשלה";
  }
  if (input.scanBanner?.status === "stale") {
    return "הסריקה הקודמת לא הסתיימה";
  }
  const last = input.lastScanStatus?.toLowerCase() ?? "";
  if (last === "failed" || last === "error") {
    return "הסריקה האחרונה נכשלה";
  }
  if (input.scanBanner?.status === "partial" && (input.scanBanner.errors ?? 0) > 0) {
    return `הסריקה הסתיימה עם ${input.scanBanner.errors} שגיאות`;
  }
  if (input.backendError?.trim()) {
    return input.backendError.trim();
  }
  if (input.backendHealthFetchFailed) {
    return "יש עדכון מערכת שלא הושלם — אנחנו מטפלים בזה";
  }
  return null;
}

function resolveWarningReason(input: DashboardSyncStateInput): string | null {
  if (
    input.gmailConnectionState === "Connected" &&
    (input.missingDriveScopes?.length ?? 0) > 0
  ) {
    return "Gmail מחובר — חסרות הרשאות Drive לשמירת קבצים";
  }
  if (input.scanBacklog) {
    return "נשארו מיילים שלא נסרקו — מומלץ להריץ סריקה נוספת";
  }
  if (input.scanBanner?.status === "truncated" || input.scanBanner?.status === "paused") {
    return "הסריקה הסתיימה חלקית";
  }
  if (input.scanBanner?.status === "success" && (input.scanBanner.found ?? 0) === 0 && (input.scanBanner.scanned ?? 0) > 0) {
    return "לא נמצאו מסמכים חדשים בסריקה האחרונה";
  }
  if (input.gmailStatusStale || input.scanStatusStale) {
    return "מציגים את המצב האחרון שידוע — לא הצלחנו לרענן עכשיו";
  }
  if (input.aiHealthy === false) {
    return "שירות ה-AI איטי זמנית";
  }
  return null;
}

function resolveSyncingLabel(input: DashboardSyncStateInput): string {
  if (input.gmailConnectionState === "Connecting") return "מחבר ל-Gmail...";
  if (input.syncingPhase?.trim()) return input.syncingPhase.trim();
  if (input.scanBanner?.status === "running") {
    const scanned = input.scanBanner.scanned ?? 0;
    const found = input.scanBanner.found ?? 0;
    return `סורקת מיילים... עברתי על ${scanned} ומצאתי ${found} מסמכים`;
  }
  return "סורקת ומעדכנת נתונים...";
}

function buildHeroTrust(input: {
  status: DashboardSyncStatus;
  message: string;
  gmailConnectionState: GmailConnectionCanonicalState;
  scanRunning: boolean;
}): HeroTrustState {
  if (input.status === "SYNCING") {
    return {
      statusLabel: input.message,
      statusTone: "info",
      ctaLabel: "הצג התקדמות",
      ctaAction: "show_scan_progress",
    };
  }
  if (input.status === "ERROR") {
    return {
      statusLabel: input.message,
      statusTone: "danger",
      ctaLabel: input.gmailConnectionState === "Disconnected" ? "חבר Gmail" : "נסה שוב",
      ctaAction: input.gmailConnectionState === "Disconnected" ? "connect_gmail" : "retry_sync",
    };
  }
  if (input.status === "WARNING") {
    return {
      statusLabel: input.message,
      statusTone: "warn",
      ctaLabel: input.scanRunning ? "הצג התקדמות" : "שאל את נטלי",
      ctaAction: input.scanRunning ? "show_scan_progress" : "ask_natalie",
    };
  }
  if (input.status === "CHECKING") {
    return {
      statusLabel: input.message,
      statusTone: "neutral",
      ctaLabel: "שאל את נטלי",
      ctaAction: "ask_natalie",
    };
  }
  return {
    statusLabel: input.message,
    statusTone: "success",
    ctaLabel: "שאל את נטלי",
    ctaAction: "ask_natalie",
  };
}

function formatRelativeTime(value: string | null | undefined, clockReady = true): string {
  if (!value) return "לא זמין";
  if (!clockReady) return "לא זמין";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "לא זמין";
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.max(0, Math.round(diffMs / 1000));
  if (seconds < 60) return `לפני ${seconds} שניות`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `לפני ${hours} שעות`;
  return date.toLocaleString("he-IL");
}

function resolveDisplayToast(
  status: DashboardSyncStatus,
  transientToast: DashboardSyncToast | null | undefined
): DashboardSyncToast | null {
  if (!transientToast) return null;
  if (transientToast.type === "success" && status !== "CONNECTED") return null;
  if (status === "ERROR") {
    return transientToast.type === "success" ? null : transientToast;
  }
  if (status === "SYNCING") {
    return transientToast.type === "info" || transientToast.type === "warning" ? transientToast : null;
  }
  if (status === "CHECKING") {
    return transientToast.type === "info" ? transientToast : null;
  }
  return transientToast;
}

function shouldShowScanBanner(status: DashboardSyncStatus, banner: ScanBannerState | null): boolean {
  if (!banner) return false;
  if (status === "ERROR") return banner.status === "error" || banner.status === "stale";
  if (status === "SYNCING") return banner.status === "running";
  if (status === "WARNING") {
    return ["running", "partial", "truncated", "paused", "stale"].includes(banner.status);
  }
  if (banner.status === "success") return false;
  return false;
}

export function isSyncRelatedDashboardMessage(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  return /ג[׳']?ימייל|Gmail|סריק|סנכרן|OAuth|מייל/i.test(normalized);
}

export function resolveDashboardSyncState(input: DashboardSyncStateInput): DashboardSyncState {
  const confirmedError = resolveConfirmedSyncIssue({
    reconnectRequired: input.gmailConnectionState === "ReconnectRequired",
    scanBannerStatus: input.scanBanner?.status ?? null,
    scanBannerErrors: input.scanBanner?.errors ?? 0,
    lastScanStatus: input.lastScanStatus ?? null,
  });
  const errorReason = resolveErrorReason(input);
  const warningReason = resolveWarningReason(input);

  let status: DashboardSyncStatus;
  let headline: string;
  let message: string;
  let reason: string | null = null;
  let tone: HeroStatusTone;

  if (isCheckingState(input)) {
    status = "CHECKING";
    headline = "בודקת מצב";
    message = "בודקת את מצב החיבור...";
    tone = "neutral";
  } else if (input.gmailConnectionState === "Disconnected") {
    status = "ERROR";
    reason = errorReason;
    headline = "Gmail לא מחובר";
    message = reason ?? headline;
    tone = "danger";
  } else if (confirmedError || errorReason) {
    status = "ERROR";
    reason = errorReason ?? "יש תקלה שדורשת טיפול";
    headline = reason;
    message = reason;
    tone = "danger";
  } else if (input.scanRunning || input.gmailConnectionState === "Connecting") {
    status = "SYNCING";
    const syncingLabel = resolveSyncingLabel(input);
    headline = "סנכרון פעיל";
    message = syncingLabel;
    tone = "info";
  } else if (warningReason || input.scanBacklog || input.gmailStatusStale || input.scanStatusStale) {
    status = "WARNING";
    reason = warningReason;
    headline = "יש לשים לב";
    message = reason ?? headline;
    tone = "warn";
  } else {
    status = "CONNECTED";
    headline = "הכל תקין";
    message = "מחוברת, סורקת ועובדת עבורך";
    tone = "success";
  }

  const syncingLabel = status === "SYNCING" ? message : null;
  const displayToast = resolveDisplayToast(status, input.transientToast);
  const displayError = status === "ERROR" ? message : null;
  const allowsSuccessToast = status === "CONNECTED";

  const healthRows: DashboardHealthRow[] = [
    {
      key: "gmail",
      label: "Gmail",
      value:
        input.gmailConnectionState === "Connected"
          ? "מחובר"
          : input.gmailConnectionState === "Connecting"
            ? "מתחבר..."
            : input.gmailConnectionState === "ReconnectRequired"
              ? "נדרש חיבור מחדש"
              : input.gmailConnectionState === "Disconnected"
                ? "לא מחובר"
                : "בודק...",
    },
    {
      key: "lastScan",
      label: "סריקה אחרונה",
      value: formatRelativeTime(input.lastSuccessfulScanAt ?? input.lastSyncAt ?? null, input.clockReady !== false),
    },
    {
      key: "documents",
      label: "מסמכים",
      value:
        input.extractedDocuments != null
          ? `${input.extractedDocuments.toLocaleString("he-IL")} נסרקו`
          : "—",
    },
    {
      key: "ai",
      label: "AI",
      value: input.aiHealthy === false ? "איטי זמנית" : "פעיל",
    },
    {
      key: "backend",
      label: "Backend",
      value: input.backendHealthy === false ? "לא זמין" : "תקין",
    },
  ];

  const heroTrust = buildHeroTrust({
    status,
    message,
    gmailConnectionState: input.gmailConnectionState,
    scanRunning: input.scanRunning,
  });

  return {
    status,
    headline,
    message,
    reason,
    tone,
    syncingLabel,
    showScanBanner: shouldShowScanBanner(status, input.scanBanner),
    scanBanner: input.scanBanner,
    displayToast,
    displayError,
    heroTrust,
    healthRows,
    integrationHasWarning: status === "WARNING",
    integrationHasError: status === "ERROR",
    allowsSuccessToast,
  };
}

export function dashboardStatesConflict(
  heroTone: HeroStatusTone,
  integrationHealth: "healthy" | "warning" | "error",
  toastType?: DashboardSyncToast["type"] | null
): boolean {
  const heroIsSuccess = heroTone === "success";
  const integrationIsError = integrationHealth === "error";
  const toastIsSuccess = toastType === "success";
  if (heroIsSuccess && integrationIsError) return true;
  if (toastIsSuccess && integrationIsError) return true;
  return false;
}

export function integrationHealthFromSyncState(state: DashboardSyncState): "healthy" | "warning" | "error" {
  if (state.integrationHasError) return "error";
  if (state.integrationHasWarning) return "warning";
  return "healthy";
}

export function assertDashboardSyncSurfacesAligned(state: DashboardSyncState): void {
  const integrationHealth = integrationHealthFromSyncState(state);
  if (dashboardStatesConflict(state.heroTrust.statusTone, integrationHealth, state.displayToast?.type ?? null)) {
    throw new Error("Dashboard sync surfaces are in conflict");
  }
}
