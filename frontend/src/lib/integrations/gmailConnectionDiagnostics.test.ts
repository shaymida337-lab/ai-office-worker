import assert from "node:assert/strict";
import test from "node:test";
import { guardGmailConnectionModel } from "./gmailConnectionGuard";
import {
  getGmailConnectionDiagnosticEvents,
  getLastObservedGmailConnectionState,
  isGmailConnectionDiagnosticsEnabled,
  recordGmailConnectionGuardRecovery,
  recordGmailConnectionModelPublished,
  resetGmailConnectionDiagnostics,
  setGmailConnectionDiagnosticsEnabled,
} from "./gmailConnectionDiagnostics";

function published(
  state: "Checking" | "Disconnected" | "Connecting" | "Connected" | "ReconnectRequired",
  source?: string
) {
  const model = {
    state,
    showConnectCta: state === "Disconnected",
    showReconnectWarning: state === "ReconnectRequired",
    treatAsConnectedForUi: state === "Connected" || state === "ReconnectRequired",
  };
  const guardResult = guardGmailConnectionModel(model);
  recordGmailConnectionModelPublished({ model: guardResult.model, guardResult, source });
  return guardResult.model;
}

test("diagnostics disabled outside development unless explicitly enabled", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.NEXT_PUBLIC_GMAIL_CONNECTION_DIAGNOSTICS;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_GMAIL_CONNECTION_DIAGNOSTICS;
    setGmailConnectionDiagnosticsEnabled(null);
    resetGmailConnectionDiagnostics();
    assert.equal(isGmailConnectionDiagnosticsEnabled(), false);
    published("Connected", "test");
    assert.equal(getGmailConnectionDiagnosticEvents().length, 0);
    assert.equal(getLastObservedGmailConnectionState(), null);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_GMAIL_CONNECTION_DIAGNOSTICS;
    else process.env.NEXT_PUBLIC_GMAIL_CONNECTION_DIAGNOSTICS = originalFlag;
    setGmailConnectionDiagnosticsEnabled(null);
    resetGmailConnectionDiagnostics();
  }
});

test("diagnostics enabled in development records valid transitions", () => {
  setGmailConnectionDiagnosticsEnabled(true);
  resetGmailConnectionDiagnostics();
  published("Checking", "bootstrap");
  published("Connected", "status_refresh");
  const events = getGmailConnectionDiagnosticEvents();
  assert.ok(events.some((event) => event.type === "state_initialized"));
  assert.ok(events.some((event) => event.type === "state_changed" && event.nextState === "Connected"));
  assert.equal(events.filter((event) => event.type === "state_changed").length, 1);
  assert.equal(getLastObservedGmailConnectionState(), "Connected");
  setGmailConnectionDiagnosticsEnabled(null);
  resetGmailConnectionDiagnostics();
});

test("diagnostics does not emit state_changed for repeated identical states", () => {
  setGmailConnectionDiagnosticsEnabled(true);
  resetGmailConnectionDiagnostics();
  published("Connected", "first");
  published("Connected", "second");
  const changed = getGmailConnectionDiagnosticEvents().filter((event) => event.type === "state_changed");
  assert.equal(changed.length, 0);
  const resolved = getGmailConnectionDiagnosticEvents().filter((event) => event.type === "state_resolved");
  assert.equal(resolved.length, 2);
  setGmailConnectionDiagnosticsEnabled(null);
  resetGmailConnectionDiagnostics();
});

test("diagnostics marks unexpected transitions without changing model", () => {
  setGmailConnectionDiagnosticsEnabled(true);
  resetGmailConnectionDiagnostics();
  published("Disconnected", "bootstrap");
  published("ReconnectRequired", "bad_jump");
  const changed = getGmailConnectionDiagnosticEvents().find((event) => event.type === "state_changed");
  assert.equal(changed?.unexpectedTransition, true);
  assert.match(changed?.reason ?? "", /unexpected transition/);
  setGmailConnectionDiagnosticsEnabled(null);
  resetGmailConnectionDiagnostics();
});

test("diagnostics records guard recovery and fallback events", () => {
  setGmailConnectionDiagnosticsEnabled(true);
  resetGmailConnectionDiagnostics();
  const guardResult = guardGmailConnectionModel({
    state: "Broken",
    showConnectCta: true,
    showReconnectWarning: true,
    treatAsConnectedForUi: true,
  });
  recordGmailConnectionGuardRecovery({ guardResult, source: "guard_test" });
  const types = getGmailConnectionDiagnosticEvents().map((event) => event.type);
  assert.ok(types.includes("fallback_applied"));
  assert.ok(types.includes("guard_recovery"));
  assert.ok(types.includes("invalid_model_corrected") || types.includes("fallback_applied"));
  setGmailConnectionDiagnosticsEnabled(null);
  resetGmailConnectionDiagnostics();
});

test("diagnostics records invalid model correction for flag violations", () => {
  setGmailConnectionDiagnosticsEnabled(true);
  resetGmailConnectionDiagnostics();
  const guardResult = guardGmailConnectionModel({
    state: "Connected",
    showConnectCta: true,
    showReconnectWarning: false,
    treatAsConnectedForUi: true,
  });
  recordGmailConnectionGuardRecovery({ guardResult, source: "guard_test" });
  assert.ok(getGmailConnectionDiagnosticEvents().some((event) => event.type === "invalid_model_corrected"));
  assert.equal(guardResult.model.showConnectCta, false);
  setGmailConnectionDiagnosticsEnabled(null);
  resetGmailConnectionDiagnostics();
});
