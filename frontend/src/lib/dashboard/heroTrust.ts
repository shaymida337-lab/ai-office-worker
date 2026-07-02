import type { GmailConnectionCanonicalState } from "./dashboardSyncState";
import { resolveDashboardSyncState } from "./dashboardSyncState";

export type HeroStatusTone = "success" | "warn" | "danger" | "info" | "neutral";

export type HeroCtaAction = "ask_natalie" | "connect_gmail" | "show_scan_progress" | "retry_sync";

export type HeroTrustState = {
  statusLabel: string;
  statusTone: HeroStatusTone;
  ctaLabel: string;
  ctaAction: HeroCtaAction;
};

type ResolveHeroTrustInput = {
  gmailConnectionState: GmailConnectionCanonicalState;
  scanStatusKnown?: boolean;
  scanStatusStale?: boolean;
  scanRunning: boolean;
};

/** @deprecated Prefer resolveDashboardSyncState — kept for narrow unit tests and legacy imports. */
export function resolveHeroTrustState(input: ResolveHeroTrustInput): HeroTrustState {
  return resolveDashboardSyncState({
    gmailConnectionState: input.gmailConnectionState,
    scanStatusKnown: input.scanStatusKnown,
    scanStatusStale: input.scanStatusStale,
    scanRunning: input.scanRunning,
    scanBanner: null,
    scanBacklog: false,
    gmailConnected: input.gmailConnectionState === "Connected",
  }).heroTrust;
}
