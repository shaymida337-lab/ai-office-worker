import type { GmailStatus } from "@/lib/api";

export type GmailStatusResolution = {
  nextStatus: GmailStatus | null;
  known: boolean;
  stale: boolean;
};

export type GmailConnectionPhase = "unknown" | "connected" | "disconnected" | "evidence_ambiguous";

export type GmailConnectionTruth = {
  phase: GmailConnectionPhase;
  apiConnected: boolean;
  showConnectCta: boolean;
  treatAsConnectedForUi: boolean;
};

type GmailActivityEvidenceInput = {
  scanLogs?: Array<{
    status: string;
    saved?: number;
    invoicesFound?: number;
    paymentsFound?: number;
    found?: number;
  }>;
  scanLast?: {
    status: string;
    saved?: number;
    invoicesFound?: number;
    paymentsFound?: number;
    found?: number;
  } | null;
  documentReviewCount?: number;
  extractedDocuments?: number | null;
};

export function resolveGmailStatusFromSettled(
  previous: GmailStatus | null,
  settled: PromiseSettledResult<GmailStatus>
): GmailStatusResolution {
  if (settled.status === "fulfilled") {
    return {
      nextStatus: settled.value,
      known: true,
      stale: false,
    };
  }
  if (previous) {
    return {
      nextStatus: previous,
      known: true,
      stale: true,
    };
  }
  return {
    nextStatus: null,
    known: false,
    stale: true,
  };
}

export function hasGmailActivityEvidence(input: GmailActivityEvidenceInput): boolean {
  if ((input.documentReviewCount ?? 0) > 0) return true;
  if ((input.extractedDocuments ?? 0) > 0) return true;

  const last = input.scanLast;
  if (last) {
    if ((last.saved ?? 0) > 0) return true;
    if ((last.invoicesFound ?? 0) > 0) return true;
    if ((last.paymentsFound ?? 0) > 0) return true;
    if ((last.found ?? 0) > 0 && ["success", "partial", "completed"].includes(last.status)) return true;
  }

  return (input.scanLogs ?? []).some((log) => {
    if ((log.saved ?? 0) > 0) return true;
    if ((log.invoicesFound ?? 0) > 0) return true;
    if ((log.paymentsFound ?? 0) > 0) return true;
    if ((log.found ?? 0) > 0 && ["success", "partial", "completed"].includes(log.status)) return true;
    return false;
  });
}

type ResolveGmailConnectionTruthInput = {
  pageLoading?: boolean;
  statusKnown: boolean;
  statusStale: boolean;
  apiConnected: boolean;
  connectedAt?: string | null;
  hasGmailActivityEvidence: boolean;
};

export function resolveGmailConnectionTruth(input: ResolveGmailConnectionTruthInput): GmailConnectionTruth {
  const apiConnected = input.apiConnected;

  if (input.pageLoading || !input.statusKnown || input.statusStale) {
    return {
      phase: "unknown",
      apiConnected,
      showConnectCta: false,
      treatAsConnectedForUi: apiConnected,
    };
  }

  if (apiConnected) {
    return {
      phase: "connected",
      apiConnected: true,
      showConnectCta: false,
      treatAsConnectedForUi: true,
    };
  }

  if (input.hasGmailActivityEvidence || Boolean(input.connectedAt)) {
    return {
      phase: "evidence_ambiguous",
      apiConnected: false,
      showConnectCta: false,
      treatAsConnectedForUi: false,
    };
  }

  return {
    phase: "disconnected",
    apiConnected: false,
    showConnectCta: true,
    treatAsConnectedForUi: false,
  };
}

export type GmailTruthAfterLoadInput = {
  gmailResolved: GmailStatusResolution;
  scanLogs?: GmailActivityEvidenceInput["scanLogs"];
  scanLast?: GmailActivityEvidenceInput["scanLast"];
  documentReviewCount: number;
};

export function resolveGmailTruthAfterLoad(input: GmailTruthAfterLoadInput): GmailConnectionTruth {
  return resolveGmailConnectionTruth({
    pageLoading: false,
    statusKnown: input.gmailResolved.known,
    statusStale: input.gmailResolved.stale,
    apiConnected: Boolean(input.gmailResolved.nextStatus?.connected),
    connectedAt: input.gmailResolved.nextStatus?.connectedAt,
    hasGmailActivityEvidence: hasGmailActivityEvidence({
      scanLogs: input.scanLogs,
      scanLast: input.scanLast,
      documentReviewCount: input.documentReviewCount,
    }),
  });
}

export function shouldAutoTriggerGmailConnect(input: {
  connectParam: string | null;
  pageLoading: boolean;
  alreadyTriggered: boolean;
  gmailConnectionPhase: GmailConnectionPhase;
}): boolean {
  if (input.pageLoading || input.alreadyTriggered) return false;
  if (input.connectParam !== "gmail") return false;
  return input.gmailConnectionPhase === "disconnected";
}
