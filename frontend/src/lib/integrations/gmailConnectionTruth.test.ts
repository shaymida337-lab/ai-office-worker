import assert from "node:assert/strict";
import test from "node:test";
import type { GmailStatus } from "@/lib/api";
import { resolveGmailStatusFromSettled } from "./gmailConnectionTruth";

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
