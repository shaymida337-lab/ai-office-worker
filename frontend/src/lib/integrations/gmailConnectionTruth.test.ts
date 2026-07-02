import assert from "node:assert/strict";
import test from "node:test";
import type { GmailStatus } from "@/lib/api";
import {
  hasGmailActivityEvidence,
  resolveGmailConnectionTruth,
  resolveGmailStatusFromSettled,
  resolveGmailTruthAfterLoad,
  shouldAutoTriggerGmailConnect,
} from "./gmailConnectionTruth";

const connectedStatus: GmailStatus = {
  googleConfigured: true,
  connected: true,
  connectedAt: "2026-07-02T10:00:00.000Z",
  reconnectRequired: false,
  missingDriveScopes: [],
};

test("resolveGmailStatusFromSettled uses fresh fulfilled result", () => {
  const result = resolveGmailStatusFromSettled(null, {
    status: "fulfilled",
    value: connectedStatus,
  });
  assert.equal(result.known, true);
  assert.equal(result.stale, false);
  assert.equal(result.nextStatus?.connected, true);
});

test("resolveGmailStatusFromSettled keeps previous connected state on request failure", () => {
  const result = resolveGmailStatusFromSettled(connectedStatus, {
    status: "rejected",
    reason: new Error("timeout"),
  });
  assert.equal(result.known, true);
  assert.equal(result.stale, true);
  assert.equal(result.nextStatus?.connected, true);
});

test("resolveGmailStatusFromSettled remains unknown when first request fails", () => {
  const result = resolveGmailStatusFromSettled(null, {
    status: "rejected",
    reason: new Error("offline"),
  });
  assert.equal(result.known, false);
  assert.equal(result.stale, true);
  assert.equal(result.nextStatus, null);
});

test("resolveGmailConnectionTruth shows connected when API reports connected", () => {
  const truth = resolveGmailConnectionTruth({
    statusKnown: true,
    statusStale: false,
    apiConnected: true,
    hasGmailActivityEvidence: false,
  });
  assert.equal(truth.phase, "connected");
  assert.equal(truth.showConnectCta, false);
});

test("resolveGmailConnectionTruth shows disconnected when API reports disconnected without evidence", () => {
  const truth = resolveGmailConnectionTruth({
    statusKnown: true,
    statusStale: false,
    apiConnected: false,
    hasGmailActivityEvidence: false,
  });
  assert.equal(truth.phase, "disconnected");
  assert.equal(truth.showConnectCta, true);
});

test("resolveGmailConnectionTruth preserves last known connected state when status fetch fails", () => {
  const truth = resolveGmailConnectionTruth({
    statusKnown: true,
    statusStale: true,
    apiConnected: true,
    hasGmailActivityEvidence: false,
  });
  assert.equal(truth.phase, "unknown");
  assert.equal(truth.showConnectCta, false);
  assert.equal(truth.treatAsConnectedForUi, true);
});

test("resolveGmailConnectionTruth avoids connect CTA when Gmail documents exist but status says disconnected", () => {
  const truth = resolveGmailConnectionTruth({
    statusKnown: true,
    statusStale: false,
    apiConnected: false,
    hasGmailActivityEvidence: true,
  });
  assert.equal(truth.phase, "evidence_ambiguous");
  assert.equal(truth.showConnectCta, false);
});

test("resolveGmailConnectionTruth avoids connect CTA when connectedAt exists without refresh token signal", () => {
  const truth = resolveGmailConnectionTruth({
    statusKnown: true,
    statusStale: false,
    apiConnected: false,
    connectedAt: "2026-06-01T10:00:00.000Z",
    hasGmailActivityEvidence: false,
  });
  assert.equal(truth.phase, "evidence_ambiguous");
  assert.equal(truth.showConnectCta, false);
});

test("resolveGmailConnectionTruth stays unknown on first status fetch failure", () => {
  const truth = resolveGmailConnectionTruth({
    statusKnown: false,
    statusStale: true,
    apiConnected: false,
    hasGmailActivityEvidence: true,
  });
  assert.equal(truth.phase, "unknown");
  assert.equal(truth.showConnectCta, false);
});

test("hasGmailActivityEvidence detects document reviews", () => {
  assert.equal(hasGmailActivityEvidence({ documentReviewCount: 5 }), true);
  assert.equal(hasGmailActivityEvidence({ documentReviewCount: 0 }), false);
});

test("hasGmailActivityEvidence detects successful scan logs", () => {
  assert.equal(
    hasGmailActivityEvidence({
      scanLogs: [{ status: "success", saved: 3 }],
    }),
    true
  );
});

test("resolveGmailTruthAfterLoad avoids connect CTA when API disconnected but Gmail documents exist", () => {
  const truth = resolveGmailTruthAfterLoad({
    gmailResolved: {
      nextStatus: {
        googleConfigured: true,
        connected: false,
        connectedAt: null,
        reconnectRequired: false,
        missingDriveScopes: [],
      },
      known: true,
      stale: false,
    },
    documentReviewCount: 12,
  });
  assert.equal(truth.phase, "evidence_ambiguous");
  assert.equal(truth.showConnectCta, false);
});

test("resolveGmailTruthAfterLoad shows connect CTA only when disconnected without evidence", () => {
  const truth = resolveGmailTruthAfterLoad({
    gmailResolved: {
      nextStatus: {
        googleConfigured: true,
        connected: false,
        connectedAt: null,
        reconnectRequired: false,
        missingDriveScopes: [],
      },
      known: true,
      stale: false,
    },
    documentReviewCount: 0,
  });
  assert.equal(truth.phase, "disconnected");
  assert.equal(truth.showConnectCta, true);
});

test("resolveGmailTruthAfterLoad keeps connected UI when API confirms connection", () => {
  const truth = resolveGmailTruthAfterLoad({
    gmailResolved: {
      nextStatus: connectedStatus,
      known: true,
      stale: false,
    },
    documentReviewCount: 139,
  });
  assert.equal(truth.phase, "connected");
  assert.equal(truth.showConnectCta, false);
});

test("shouldAutoTriggerGmailConnect only when confirmed disconnected", () => {
  assert.equal(
    shouldAutoTriggerGmailConnect({
      connectParam: "gmail",
      pageLoading: false,
      alreadyTriggered: false,
      gmailConnectionPhase: "disconnected",
    }),
    true
  );
  assert.equal(
    shouldAutoTriggerGmailConnect({
      connectParam: "gmail",
      pageLoading: false,
      alreadyTriggered: false,
      gmailConnectionPhase: "evidence_ambiguous",
    }),
    false
  );
  assert.equal(
    shouldAutoTriggerGmailConnect({
      connectParam: "gmail",
      pageLoading: true,
      alreadyTriggered: false,
      gmailConnectionPhase: "disconnected",
    }),
    false
  );
});
