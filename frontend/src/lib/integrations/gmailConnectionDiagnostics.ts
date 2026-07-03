import type { GmailConnectionGuardResult } from "./gmailConnectionGuard";
import type {
  GmailConnectionCanonicalState,
  GmailConnectionStateModel,
} from "./gmailConnectionState";

export type GmailConnectionDiagnosticEventType =
  | "state_initialized"
  | "state_resolved"
  | "state_changed"
  | "guard_recovery"
  | "invalid_model_corrected"
  | "fallback_applied";

export type GmailConnectionDiagnosticEvent = {
  type: GmailConnectionDiagnosticEventType;
  at: number;
  previousState: GmailConnectionCanonicalState | null;
  nextState: GmailConnectionCanonicalState;
  reason: string;
  recoveryApplied: boolean;
  unexpectedTransition: boolean;
  source?: string;
  violations?: string[];
};

const EXPECTED_TRANSITIONS = new Set<string>([
  "Checking->Connected",
  "Checking->ReconnectRequired",
  "Checking->Disconnected",
  "Checking->Connecting",
  "Connecting->Connected",
  "Connecting->Disconnected",
  "Connecting->Checking",
  "Connected->ReconnectRequired",
  "Connected->Disconnected",
  "Connected->Checking",
  "ReconnectRequired->Connected",
  "ReconnectRequired->Disconnected",
  "ReconnectRequired->Checking",
  "Disconnected->Connecting",
  "Disconnected->Connected",
  "Disconnected->Checking",
]);

const MAX_EVENTS = 50;

let diagnosticsOverride: boolean | null = null;
let lastObservedState: GmailConnectionCanonicalState | null = null;
const diagnosticEvents: GmailConnectionDiagnosticEvent[] = [];

export function isGmailConnectionDiagnosticsEnabled(): boolean {
  if (diagnosticsOverride !== null) return diagnosticsOverride;
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_GMAIL_CONNECTION_DIAGNOSTICS === "1") {
    return true;
  }
  return process.env.NODE_ENV === "development";
}

/** Test-only override; pass null to restore default behavior. */
export function setGmailConnectionDiagnosticsEnabled(enabled: boolean | null) {
  diagnosticsOverride = enabled;
}

export function resetGmailConnectionDiagnostics() {
  lastObservedState = null;
  diagnosticEvents.length = 0;
}

export function getGmailConnectionDiagnosticEvents(): GmailConnectionDiagnosticEvent[] {
  return [...diagnosticEvents];
}

export function getLastObservedGmailConnectionState(): GmailConnectionCanonicalState | null {
  return lastObservedState;
}

function isUnexpectedTransition(
  from: GmailConnectionCanonicalState | null,
  to: GmailConnectionCanonicalState
): boolean {
  if (from === null || from === to) return false;
  return !EXPECTED_TRANSITIONS.has(`${from}->${to}`);
}

function pushDiagnosticEvent(event: GmailConnectionDiagnosticEvent) {
  diagnosticEvents.push(event);
  if (diagnosticEvents.length > MAX_EVENTS) {
    diagnosticEvents.shift();
  }
  console.info("[gmail-connection-diagnostics]", {
    type: event.type,
    previousState: event.previousState,
    nextState: event.nextState,
    reason: event.reason,
    recoveryApplied: event.recoveryApplied,
    unexpectedTransition: event.unexpectedTransition,
    source: event.source,
    violations: event.violations,
  });
}

function recordEvent(
  type: GmailConnectionDiagnosticEventType,
  input: {
    previousState: GmailConnectionCanonicalState | null;
    nextState: GmailConnectionCanonicalState;
    reason: string;
    recoveryApplied: boolean;
    unexpectedTransition?: boolean;
    source?: string;
    violations?: string[];
  }
) {
  pushDiagnosticEvent({
    type,
    at: Date.now(),
    previousState: input.previousState,
    nextState: input.nextState,
    reason: input.reason,
    recoveryApplied: input.recoveryApplied,
    unexpectedTransition: Boolean(input.unexpectedTransition),
    source: input.source,
    violations: input.violations,
  });
}

export function recordGmailConnectionGuardRecovery(input: {
  guardResult: GmailConnectionGuardResult;
  source?: string;
}) {
  if (!isGmailConnectionDiagnosticsEnabled() || !input.guardResult.recovered) return;

  const hadUnknownState = input.guardResult.violations.some((item) => item.includes("unknown state"));
  const hadMissingModel = input.guardResult.violations.some((item) => item.includes("missing model"));

  recordEvent(hadUnknownState || hadMissingModel ? "fallback_applied" : "invalid_model_corrected", {
    previousState: lastObservedState,
    nextState: input.guardResult.model.state,
    reason: input.guardResult.violations.join("; "),
    recoveryApplied: true,
    source: input.source ?? "guard",
    violations: input.guardResult.violations,
  });

  recordEvent("guard_recovery", {
    previousState: lastObservedState,
    nextState: input.guardResult.model.state,
    reason: "runtime guard corrected model",
    recoveryApplied: true,
    source: input.source ?? "guard",
    violations: input.guardResult.violations,
  });
}

export function recordGmailConnectionModelPublished(input: {
  model: GmailConnectionStateModel;
  guardResult: GmailConnectionGuardResult;
  source?: string;
}) {
  if (!isGmailConnectionDiagnosticsEnabled()) return;

  const previousState = lastObservedState;
  const nextState = input.model.state;
  const unexpectedTransition = isUnexpectedTransition(previousState, nextState);

  if (previousState === null) {
    recordEvent("state_initialized", {
      previousState: null,
      nextState,
      reason: input.source ?? "resolve",
      recoveryApplied: input.guardResult.recovered,
      source: input.source,
      violations: input.guardResult.violations,
    });
  } else if (previousState !== nextState) {
    recordEvent("state_changed", {
      previousState,
      nextState,
      reason: unexpectedTransition
        ? `unexpected transition ${previousState} -> ${nextState}`
        : `transition ${previousState} -> ${nextState}`,
      recoveryApplied: input.guardResult.recovered,
      unexpectedTransition,
      source: input.source,
      violations: input.guardResult.violations,
    });
  }

  recordEvent("state_resolved", {
    previousState,
    nextState,
    reason: input.source ?? "resolve",
    recoveryApplied: input.guardResult.recovered,
    unexpectedTransition,
    source: input.source,
    violations: input.guardResult.violations,
  });

  lastObservedState = nextState;
}
