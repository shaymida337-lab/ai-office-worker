import type { ScanBannerStatus } from "@/lib/gmailScanBanner";
import type { HeroStatusTone } from "./heroTrust";
import {
  integrationHealthFromSyncState,
  type DashboardSyncState,
  type DashboardSyncToast,
} from "./dashboardSyncState";

export type DashboardMessageStack = {
  error: string;
  actionMessage: string;
  toast: DashboardSyncToast | null;
};

export type DashboardSyncSurfaces = {
  heroTone: HeroStatusTone;
  heroLabel: string;
  messageStack: DashboardMessageStack;
  integrationHealth: "healthy" | "warning" | "error";
  integrationDescription: string;
  scanBannerVisible: boolean;
  scanBannerStatus: ScanBannerStatus | null;
};

const SUCCESS_SCAN_TEXT = /הסריקה\s+הסתיימה|הנתונים\s+עודכנו|עודכנו/i;
const LEGACY_SYNC_ERROR_TEXT = /יש\s+בעיית\s+סנכרון/i;

function isSuccessClassMessage(text: string): boolean {
  return SUCCESS_SCAN_TEXT.test(text.trim());
}

function isErrorClassTone(tone: HeroStatusTone): boolean {
  return tone === "danger";
}

function isSuccessClassTone(tone: HeroStatusTone): boolean {
  return tone === "success";
}

export function resolveDisplayActionMessage(
  status: DashboardSyncState["status"],
  actionMessage: string
): string {
  const trimmed = actionMessage.trim();
  if (!trimmed) return "";
  if (status === "ERROR" || status === "SYNCING" || status === "CHECKING") return "";
  if (status !== "CONNECTED" && isSuccessClassMessage(trimmed)) return "";
  return trimmed;
}

export function buildDashboardMessageStack(
  state: DashboardSyncState,
  input: { pageError: string; actionMessage: string }
): DashboardMessageStack {
  const filteredPageError =
    state.displayError
    ?? (input.pageError.trim() && state.status !== "ERROR" ? input.pageError.trim() : "");

  return {
    error: filteredPageError,
    actionMessage: resolveDisplayActionMessage(state.status, input.actionMessage),
    toast: state.displayToast,
  };
}

export function buildDashboardSyncSurfaces(
  state: DashboardSyncState,
  input: { pageError: string; actionMessage: string }
): DashboardSyncSurfaces {
  return {
    heroTone: state.heroTrust.statusTone,
    heroLabel: state.heroTrust.statusLabel,
    messageStack: buildDashboardMessageStack(state, input),
    integrationHealth: integrationHealthFromSyncState(state),
    integrationDescription: state.message,
    scanBannerVisible: state.showScanBanner,
    scanBannerStatus: state.scanBanner?.status ?? null,
  };
}

export function hasDashboardSyncSurfaceConflict(surfaces: DashboardSyncSurfaces): boolean {
  const { heroTone, heroLabel, messageStack, integrationHealth } = surfaces;
  const toast = messageStack.toast;
  const hasSuccessToast = toast?.type === "success";
  const hasErrorToast = toast?.type === "error";
  const hasSuccessAction = Boolean(messageStack.actionMessage) && isSuccessClassMessage(messageStack.actionMessage);
  const hasErrorHero = isErrorClassTone(heroTone) || LEGACY_SYNC_ERROR_TEXT.test(heroLabel);
  const hasSuccessHero = isSuccessClassTone(heroTone);
  const hasErrorStack = Boolean(messageStack.error);
  const integrationIsError = integrationHealth === "error";

  if (hasSuccessToast && (hasErrorHero || hasErrorStack || integrationIsError)) return true;
  if (hasSuccessAction && (hasErrorHero || hasErrorStack || integrationIsError)) return true;
  if (hasSuccessHero && (integrationIsError || hasErrorStack || hasErrorToast)) return true;
  if (hasSuccessToast && hasErrorToast) return true;
  return false;
}

/** Replicates committed production heroTrust + raw toast behavior that caused the screenshot bug. */
export function legacyProductionDashboardConflict(input: {
  hasSyncIssue: boolean;
  scanToast: DashboardSyncToast | null;
}): boolean {
  const heroTone: HeroStatusTone = input.hasSyncIssue ? "danger" : "success";
  const heroLabel = input.hasSyncIssue
    ? "יש בעיית סנכרון — אפשר לנסות שוב."
    : "מחוברת, סורקת ועובדת עבורך";

  return hasDashboardSyncSurfaceConflict({
    heroTone,
    heroLabel,
    messageStack: {
      error: "",
      actionMessage: "",
      toast: input.scanToast,
    },
    integrationHealth: input.hasSyncIssue ? "warning" : "healthy",
    integrationDescription: input.hasSyncIssue ? "יש בעיית סנכרון" : "מערכת תקינה",
    scanBannerVisible: false,
    scanBannerStatus: null,
  });
}

export function assertDashboardSyncSurfacesConsistent(surfaces: DashboardSyncSurfaces): void {
  if (hasDashboardSyncSurfaceConflict(surfaces)) {
    throw new Error("Dashboard sync surfaces are in conflict");
  }
}
