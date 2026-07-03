import type { GmailStatus } from "@/lib/api";
import { recordGmailConnectionModelPublished } from "./gmailConnectionDiagnostics";
import { guardGmailConnectionModel } from "./gmailConnectionGuard";

export type GmailConnectionCanonicalState =
  | "Checking"
  | "Disconnected"
  | "Connecting"
  | "Connected"
  | "ReconnectRequired";

export type GmailConnectionStateInput = {
  loading: boolean;
  connecting: boolean;
  connected: boolean;
  reconnectRequired: boolean;
};

export type GmailConnectionStateModel = {
  state: GmailConnectionCanonicalState;
  showConnectCta: boolean;
  showReconnectWarning: boolean;
  treatAsConnectedForUi: boolean;
};

export type BuildGmailConnectionContextInput = {
  pageLoading?: boolean;
  statusKnown: boolean;
  statusStale: boolean;
  connecting: boolean;
  status: Pick<GmailStatus, "connected" | "reconnectRequired"> | null;
  hasGmailActivityEvidence?: boolean;
  connectedAt?: string | null;
};

function publishGmailConnectionModel(
  model: GmailConnectionStateModel,
  source = "resolve"
): GmailConnectionStateModel {
  const guardResult = guardGmailConnectionModel(model);
  recordGmailConnectionModelPublished({ model: guardResult.model, guardResult, source });
  return guardResult.model;
}

export function resolveGmailConnectionState(input: GmailConnectionStateInput): GmailConnectionStateModel {
  if (input.connecting) {
    return publishGmailConnectionModel({
      state: "Connecting",
      showConnectCta: false,
      showReconnectWarning: false,
      treatAsConnectedForUi: false,
    });
  }

  if (input.loading) {
    return publishGmailConnectionModel({
      state: "Checking",
      showConnectCta: false,
      showReconnectWarning: false,
      treatAsConnectedForUi: input.connected,
    });
  }

  if (!input.connected) {
    return publishGmailConnectionModel({
      state: "Disconnected",
      showConnectCta: true,
      showReconnectWarning: false,
      treatAsConnectedForUi: false,
    });
  }

  if (input.reconnectRequired) {
    return publishGmailConnectionModel({
      state: "ReconnectRequired",
      showConnectCta: false,
      showReconnectWarning: true,
      treatAsConnectedForUi: true,
    });
  }

  return publishGmailConnectionModel({
    state: "Connected",
    showConnectCta: false,
    showReconnectWarning: false,
    treatAsConnectedForUi: true,
  });
}

export function buildGmailConnectionContext(input: BuildGmailConnectionContextInput): GmailConnectionStateModel {
  const connected = Boolean(input.status?.connected);
  const reconnectRequired = Boolean(input.status?.reconnectRequired);
  const verificationPending =
    input.statusKnown &&
    !connected &&
    (Boolean(input.hasGmailActivityEvidence) || Boolean(input.connectedAt));

  return resolveGmailConnectionState({
    loading: Boolean(input.pageLoading) || !input.statusKnown || input.statusStale || verificationPending,
    connecting: input.connecting,
    connected,
    reconnectRequired,
  });
}

export function isGmailConnectionOperational(state: GmailConnectionCanonicalState): boolean {
  return state === "Connected" || state === "ReconnectRequired";
}
