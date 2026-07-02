import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardSyncState, type DashboardSyncStateInput } from "../../../lib/dashboard/dashboardSyncState.js";
import {
  buildDashboardStatusPillLabel,
  dashboardStatusPillHasEnglish,
} from "./dashboardStatusPillCopy.js";

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
    lastSuccessfulScanAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    lastSyncAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    scannedEmails: 12,
    extractedDocuments: 5,
    aiHealthy: true,
    backendHealthy: true,
    ...overrides,
  };
}

test("pill CONNECTED shows Hebrew connected copy with relative update time", () => {
  const state = resolveDashboardSyncState(baseInput());
  const label = buildDashboardStatusPillLabel(state);
  assert.match(label, /^🟢 מחובר ומסונכרן · עודכן לפני \d+ דקות$/);
  assert.equal(dashboardStatusPillHasEnglish(label), false);
});

test("pill SYNCING shows scanning copy with document count", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanRunning: true,
      scanBanner: { status: "running", found: 7, scanned: 20, errors: 0 },
    })
  );
  const label = buildDashboardStatusPillLabel(state);
  assert.match(label, /^🔵 סורקת מיילים… · 7 מסמכים$/);
  assert.equal(dashboardStatusPillHasEnglish(label), false);
});

test("pill WARNING shows short Hebrew warning", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      scanBacklog: true,
      scanBanner: null,
    })
  );
  assert.equal(buildDashboardStatusPillLabel(state), "🟡 יש משהו לבדוק");
});

test("pill ERROR shows short Hebrew error", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "Disconnected",
      gmailConnected: false,
    })
  );
  assert.equal(buildDashboardStatusPillLabel(state), "🔴 צריך טיפול");
});

test("pill CHECKING shows stale/offline copy", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailStatusKnown: false,
      gmailConnectionState: "Checking",
    })
  );
  assert.equal(buildDashboardStatusPillLabel(state), "⚪ מציג מידע אחרון");
});

test("pill loading shows checking placeholder", () => {
  const state = resolveDashboardSyncState(baseInput());
  assert.equal(buildDashboardStatusPillLabel(state, true), "⚪ בודקת מצב...");
});

test("REGRESSION: error pill state suppresses success toast from sync state", () => {
  const state = resolveDashboardSyncState(
    baseInput({
      gmailConnectionState: "ReconnectRequired",
      gmailConnected: false,
      transientToast: { type: "success", text: "הסריקה הסתיימה והנתונים עודכנו" },
    })
  );
  assert.equal(state.status, "ERROR");
  assert.equal(state.displayToast, null);
  assert.equal(buildDashboardStatusPillLabel(state), "🔴 צריך טיפול");
});
