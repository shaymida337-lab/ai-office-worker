import test from "node:test";
import assert from "node:assert/strict";
import {
  dashboardStatesConflict,
  resolveDashboardSyncState,
  assertDashboardSyncSurfacesAligned,
  type DashboardSyncStateInput,
} from "./dashboardSyncState.js";

function baseInput(overrides: Partial<DashboardSyncStateInput> = {}): DashboardSyncStateInput {
  return {
    gmailConnectionState: "Connected",
    gmailStatusKnown: true,
    gmailStatusStale: false,
    scanStatusKnown: true,
    scanStatusStale: false,
    scanRunning: false,
    scanBanner: { status: "success", found: 3, scanned: 12, errors: 0 },
    scanBacklog: false,
    lastScanStatus: "success",
    backendError: null,
    transientToast: null,
    syncingPhase: null,
    gmailConnected: true,
    lastSuccessfulScanAt: new Date(Date.now() - 18_000).toISOString(),
    lastSyncAt: new Date(Date.now() - 18_000).toISOString(),
    scannedEmails: 12,
    extractedDocuments: 5,
    aiHealthy: true,
    backendHealthy: true,
    ...overrides,
  };
}

test("connected state renders correctly", () => {
  const state = resolveDashboardSyncState(baseInput());
  assert.equal(state.status, "CONNECTED");
  assert.equal(state.headline, "הכל תקין");
  assert.equal(state.heroTrust.statusTone, "success");
  assert.equal(state.integrationHasError, false);
});

test("syncing state renders correctly", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanRunning: true,
      scanBanner: { status: "running", found: 2, scanned: 8, errors: 0 },
      syncingPhase: "מחפש הודעות...",
    })
  );
  assert.equal(state.status, "SYNCING");
  assert.match(state.message, /מחפש הודעות/);
  assert.equal(state.showScanBanner, true);
});

test("warning state renders correctly for backlog", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanBacklog: true,
      scanBanner: { status: "truncated", found: 1, scanned: 50, totalMatched: 200, errors: 0 },
    })
  );
  assert.equal(state.status, "WARNING");
  assert.equal(state.tone, "warn");
  assert.match(state.message, /חלקית|מיילים/);
});

test("error state renders with explicit reason for reconnect", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      gmailConnected: false,
    })
  );
  assert.equal(state.status, "ERROR");
  assert.match(state.reason ?? "", /Gmail|OAuth|חיבור/);
  assert.doesNotMatch(state.message, /יש בעיית סנכרון$/);
});

test("error state renders for scan failure", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanBanner: { status: "error", found: 0, scanned: 0, errors: 1 },
      lastScanStatus: "failed",
    })
  );
  assert.equal(state.status, "ERROR");
  assert.match(state.reason ?? "", /נכשל/);
});

test("success never coexists with error in display toast", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      transientToast: { type: "success", text: "הסריקה הסתיימה והנתונים עודכנו" },
    })
  );
  assert.equal(state.status, "ERROR");
  assert.equal(state.displayToast, null);
});

test("success toast blocked when status is warning", () => {
  const warning = resolveDashboardSyncState(
    baseInput({
      scanBacklog: true,
      scanBanner: { status: "truncated", found: 1, scanned: 50, totalMatched: 200, errors: 0 },
      transientToast: { type: "success", text: "הסריקה הסתיימה" },
    })
  );
  assert.equal(warning.displayToast, null);
  assert.equal(warning.allowsSuccessToast, false);
});

test("success banner hidden for connected success scan", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanBanner: { status: "success", found: 2, scanned: 10, errors: 0 },
    })
  );
  assert.equal(state.showScanBanner, false);
});

test("contradictory hero success + integration error is detectable", () => {
  assert.equal(
    dashboardStatesConflict("success", "error", "success"),
    true
  );
  assert.equal(
    dashboardStatesConflict("success", "healthy", "success"),
    false
  );
});

test("checking state while scan status unknown", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanStatusKnown: false,
    })
  );
  assert.equal(state.status, "CHECKING");
});

test("warning state for stale scan status refresh", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanStatusStale: true,
    })
  );
  assert.equal(state.status, "WARNING");
  assert.match(state.message, /מציגים את המצב האחרון/);
});

test("aligned dashboard surfaces never conflict for canonical URL", () => {
  const state = resolveDashboardSyncState(baseInput());
  assert.doesNotThrow(() => assertDashboardSyncSurfacesAligned(state));
});

test("aligned dashboard surfaces never conflict for reconnect error", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      transientToast: { type: "error", text: "OAuth expired" },
    })
  );
  assert.doesNotThrow(() => assertDashboardSyncSurfacesAligned(state));
});

test("success toast auto-dismiss eligibility", () => {
  const connected = resolveDashboardSyncState(
    baseInput({
      transientToast: { type: "success", text: "הסריקה הסתיימה" },
    })
  );
  assert.equal(connected.allowsSuccessToast, true);

  const error = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      transientToast: { type: "success", text: "הסריקה הסתיימה" },
    })
  );
  assert.equal(error.allowsSuccessToast, false);
  assert.equal(error.displayToast, null);
});

test("error survives refresh semantics via persistent reconnect state", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      transientToast: null,
    })
  );
  assert.equal(state.status, "ERROR");
  assert.equal(state.displayError, state.message);
});
