import type {
  GmailConnectionCanonicalState,
  GmailConnectionStateModel,
} from "./gmailConnectionState";
import { recordGmailConnectionGuardRecovery } from "./gmailConnectionDiagnostics";

export const GMAIL_CONNECTION_CANONICAL_STATES = [
  "Checking",
  "Disconnected",
  "Connecting",
  "Connected",
  "ReconnectRequired",
] as const satisfies readonly GmailConnectionCanonicalState[];

export type GmailConnectionGuardResult = {
  model: GmailConnectionStateModel;
  recovered: boolean;
  violations: string[];
};

export function isKnownGmailConnectionState(value: unknown): value is GmailConnectionCanonicalState {
  return (
    typeof value === "string" &&
    (GMAIL_CONNECTION_CANONICAL_STATES as readonly string[]).includes(value)
  );
}

function canonicalModelForState(
  state: GmailConnectionCanonicalState,
  options?: { preserveCheckingConnectedHint?: boolean }
): GmailConnectionStateModel {
  switch (state) {
    case "Checking":
      return {
        state,
        showConnectCta: false,
        showReconnectWarning: false,
        treatAsConnectedForUi: Boolean(options?.preserveCheckingConnectedHint),
      };
    case "Disconnected":
      return {
        state,
        showConnectCta: true,
        showReconnectWarning: false,
        treatAsConnectedForUi: false,
      };
    case "Connecting":
      return {
        state,
        showConnectCta: false,
        showReconnectWarning: false,
        treatAsConnectedForUi: false,
      };
    case "Connected":
      return {
        state,
        showConnectCta: false,
        showReconnectWarning: false,
        treatAsConnectedForUi: true,
      };
    case "ReconnectRequired":
      return {
        state,
        showConnectCta: false,
        showReconnectWarning: true,
        treatAsConnectedForUi: true,
      };
  }
}

function logGuardRecovery(violations: string[], before: unknown, after: GmailConnectionStateModel) {
  if (process.env.NODE_ENV !== "development" || violations.length === 0) return;
  console.warn("[gmail-connection-guard] recovered invalid Gmail connection model", {
    violations,
    before,
    after,
  });
}

export function guardGmailConnectionModel(
  input: Partial<GmailConnectionStateModel> & { state?: unknown }
): GmailConnectionGuardResult {
  const violations: string[] = [];

  if (!input || typeof input !== "object") {
    violations.push("missing model");
    const model = canonicalModelForState("Checking");
    logGuardRecovery(violations, input, model);
    const result = { model, recovered: true, violations };
    recordGmailConnectionGuardRecovery({ guardResult: result, source: "guard" });
    return result;
  }

  if (!isKnownGmailConnectionState(input.state)) {
    violations.push(`unknown state "${String(input.state)}"`);
    const model = canonicalModelForState("Checking");
    logGuardRecovery(violations, input, model);
    const result = { model, recovered: true, violations };
    recordGmailConnectionGuardRecovery({ guardResult: result, source: "guard" });
    return result;
  }

  const state = input.state;
  const expected = canonicalModelForState(state, {
    preserveCheckingConnectedHint:
      state === "Checking" ? Boolean(input.treatAsConnectedForUi) : undefined,
  });

  let model: GmailConnectionStateModel = {
    state,
    showConnectCta: Boolean(input.showConnectCta),
    showReconnectWarning: Boolean(input.showReconnectWarning),
    treatAsConnectedForUi: Boolean(input.treatAsConnectedForUi),
  };

  if (model.showConnectCta !== expected.showConnectCta) {
    violations.push(`showConnectCta must be ${expected.showConnectCta} for ${state}`);
    model.showConnectCta = expected.showConnectCta;
  }

  if (model.showReconnectWarning !== expected.showReconnectWarning) {
    violations.push(`showReconnectWarning must be ${expected.showReconnectWarning} for ${state}`);
    model.showReconnectWarning = expected.showReconnectWarning;
  }

  if (model.treatAsConnectedForUi !== expected.treatAsConnectedForUi) {
    violations.push(`treatAsConnectedForUi must be ${expected.treatAsConnectedForUi} for ${state}`);
    model.treatAsConnectedForUi = expected.treatAsConnectedForUi;
  }

  if (violations.length > 0) {
    logGuardRecovery(violations, input, model);
  }

  const result = {
    model,
    recovered: violations.length > 0,
    violations,
  };
  if (result.recovered) {
    recordGmailConnectionGuardRecovery({ guardResult: result, source: "guard" });
  }

  return result;
}

/** UI-safe projection: never exposes connect CTA outside Disconnected. */
export function gmailConnectionUiAllowsConnectCta(model: GmailConnectionStateModel): boolean {
  return guardGmailConnectionModel(model).model.state === "Disconnected" && model.showConnectCta;
}

/** UI-safe projection: reconnect warnings only for ReconnectRequired. */
export function gmailConnectionUiShowsReconnectWarning(model: GmailConnectionStateModel): boolean {
  return guardGmailConnectionModel(model).model.state === "ReconnectRequired" && model.showReconnectWarning;
}
