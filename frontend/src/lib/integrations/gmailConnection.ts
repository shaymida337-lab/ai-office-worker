import type { GmailStatus } from "@/lib/api";
import {
  guardGmailConnectionModel,
  gmailConnectionUiAllowsConnectCta,
  gmailConnectionUiShowsReconnectWarning,
} from "./gmailConnectionGuard";
import {
  buildGmailConnectionContext,
  type BuildGmailConnectionContextInput,
  type GmailConnectionCanonicalState,
  type GmailConnectionStateModel,
  isGmailConnectionOperational,
  resolveGmailConnectionState,
} from "./gmailConnectionState";

export {
  buildGmailConnectionContext,
  isGmailConnectionOperational,
  resolveGmailConnectionState,
  type BuildGmailConnectionContextInput,
  type GmailConnectionCanonicalState,
  type GmailConnectionStateModel,
};

export {
  hasGmailActivityEvidence,
  resolveGmailConnectionTruth,
  resolveGmailStatusFromSettled,
  resolveGmailTruthAfterLoad,
  shouldAutoTriggerGmailConnect,
} from "./gmailConnectionTruth";

export {
  guardGmailConnectionModel,
  gmailConnectionUiAllowsConnectCta,
  gmailConnectionUiShowsReconnectWarning,
  GMAIL_CONNECTION_CANONICAL_STATES,
  isKnownGmailConnectionState,
  type GmailConnectionGuardResult,
} from "./gmailConnectionGuard";

export {
  getGmailConnectionDiagnosticEvents,
  getLastObservedGmailConnectionState,
  isGmailConnectionDiagnosticsEnabled,
  resetGmailConnectionDiagnostics,
  setGmailConnectionDiagnosticsEnabled,
  type GmailConnectionDiagnosticEvent,
  type GmailConnectionDiagnosticEventType,
} from "./gmailConnectionDiagnostics";

export function buildGmailConnectionFromStatus(
  status: GmailStatus | null,
  options: Omit<BuildGmailConnectionContextInput, "status"> = {
    statusKnown: false,
    statusStale: false,
    connecting: false,
  }
): GmailConnectionStateModel {
  return buildGmailConnectionContext({
    ...options,
    status: status
      ? { connected: status.connected, reconnectRequired: status.reconnectRequired }
      : null,
  });
}

export function isGmailConnectionDisconnected(state: GmailConnectionCanonicalState): boolean {
  return state === "Disconnected";
}

export function isGmailConnectionChecking(state: GmailConnectionCanonicalState): boolean {
  return state === "Checking" || state === "Connecting";
}

export function isGmailContentOperational(state?: GmailConnectionCanonicalState): boolean {
  return state === "Connected" || state === "ReconnectRequired";
}

export function gmailConnectionAllowsConnect(model: GmailConnectionStateModel): boolean {
  return gmailConnectionUiAllowsConnectCta(model);
}

export function gmailConnectionShowsReconnect(model: GmailConnectionStateModel): boolean {
  return gmailConnectionUiShowsReconnectWarning(model);
}

export function gmailConnectionBadgeLabel(
  model: GmailConnectionStateModel,
  options?: { googleConfigured?: boolean }
): string {
  switch (model.state) {
    case "Checking":
      return "בודק חיבור...";
    case "Connecting":
      return "מתחבר...";
    case "Disconnected":
      return options?.googleConfigured === false ? "התחברות גוגל לא מוגדרת" : "לא מחובר";
    case "ReconnectRequired":
    case "Connected":
      return "מחובר";
  }
}

export function gmailReconnectActionLabel(model: GmailConnectionStateModel): string {
  return model.state === "ReconnectRequired" ? "חבר מחדש את גוגל" : "חבר ג׳ימייל מחדש";
}
