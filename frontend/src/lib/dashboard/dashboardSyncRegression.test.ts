import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardSyncSurfaces,
  hasDashboardSyncSurfaceConflict,
  legacyProductionDashboardConflict,
} from "./dashboardSyncPresentation.js";
import { resolveDashboardSyncState, type DashboardSyncStateInput } from "./dashboardSyncState.js";

const SCREENSHOT_SUCCESS_TOAST = "הסריקה הסתיימה והנתונים עודכנו";
const LEGACY_SYNC_ERROR = "יש בעיית סנכרון — אפשר לנסות שוב.";

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

test("REGRESSION: legacy production allowed screenshot contradiction", () => {
  const conflict = legacyProductionDashboardConflict({
    hasSyncIssue: true,
    scanToast: { type: "success", text: SCREENSHOT_SUCCESS_TOAST },
  });
  assert.equal(conflict, true, "production hero error + success toast was possible");
});

test("REGRESSION: screenshot scan-success + stale sync error cannot render together", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanBanner: { status: "stale", found: 0, scanned: 0, errors: 0 },
      lastScanStatus: "running",
      transientToast: { type: "success", text: SCREENSHOT_SUCCESS_TOAST },
    })
  );
  const surfaces = buildDashboardSyncSurfaces(state, { pageError: "", actionMessage: "" });
  assert.equal(state.displayToast, null);
  assert.notEqual(state.heroTrust.statusTone, "success");
  assert.doesNotMatch(state.heroTrust.statusLabel, /יש בעיית סנכרון/);
  assert.equal(hasDashboardSyncSurfaceConflict(surfaces), false);
});

test("REGRESSION: screenshot scan-success + reconnect required cannot render together", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      gmailConnected: false,
      transientToast: { type: "success", text: SCREENSHOT_SUCCESS_TOAST },
    })
  );
  const surfaces = buildDashboardSyncSurfaces(state, { pageError: "", actionMessage: "" });
  assert.equal(state.displayToast, null);
  assert.equal(state.heroTrust.statusTone, "danger");
  assert.notEqual(state.heroTrust.statusLabel, LEGACY_SYNC_ERROR);
  assert.match(state.heroTrust.statusLabel, /ג׳ימייל|הרשאות|תוקף|חיבור/);
  assert.equal(hasDashboardSyncSurfaceConflict(surfaces), false);
});

test("REGRESSION: screenshot scan-success + partial scan errors cannot render together", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanBanner: { status: "partial", found: 2, scanned: 10, errors: 3 },
      lastScanStatus: "partial",
      transientToast: { type: "success", text: SCREENSHOT_SUCCESS_TOAST },
    })
  );
  const surfaces = buildDashboardSyncSurfaces(state, { pageError: "", actionMessage: "" });
  assert.equal(state.displayToast, null);
  assert.equal(state.status, "ERROR");
  assert.equal(hasDashboardSyncSurfaceConflict(surfaces), false);
});

test("REGRESSION: success actionMessage suppressed during sync error", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      gmailConnected: false,
    })
  );
  const surfaces = buildDashboardSyncSurfaces(state, {
    pageError: "",
    actionMessage: "הסריקה הסתיימה והנתונים עודכנו",
  });
  assert.equal(surfaces.messageStack.actionMessage, "");
  assert.equal(hasDashboardSyncSurfaceConflict(surfaces), false);
});

test("REGRESSION: integration warning aligns with hero on backlog warning", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanBacklog: true,
      scanBanner: { status: "truncated", found: 1, scanned: 50, totalMatched: 200, errors: 0 },
    })
  );
  const surfaces = buildDashboardSyncSurfaces(state, { pageError: "", actionMessage: "" });
  assert.equal(state.status, "WARNING");
  assert.equal(surfaces.integrationHealth, "warning");
  assert.equal(surfaces.heroTone, "warn");
  assert.equal(hasDashboardSyncSurfaceConflict(surfaces), false);
});

test("REGRESSION: connected scan-complete toast allowed only when fully connected", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      transientToast: { type: "success", text: SCREENSHOT_SUCCESS_TOAST },
    })
  );
  const surfaces = buildDashboardSyncSurfaces(state, { pageError: "", actionMessage: "" });
  assert.equal(state.status, "CONNECTED");
  assert.equal(surfaces.messageStack.toast?.type, "success");
  assert.equal(hasDashboardSyncSurfaceConflict(surfaces), false);
});
