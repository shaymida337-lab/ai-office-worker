import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfirmedSyncIssue, resolveScanStatusFromSettled } from "./scanStatusTruth";

test("resolveScanStatusFromSettled keeps previous scan status on fetch failure", () => {
  const previous = { last: { status: "success" }, logs: [] };
  const resolved = resolveScanStatusFromSettled(previous, { status: "rejected", reason: new Error("network") });
  assert.equal(resolved.known, true);
  assert.equal(resolved.stale, true);
  assert.equal(resolved.nextStatus, previous);
});

test("resolveScanStatusFromSettled remains unknown when first fetch fails", () => {
  const resolved = resolveScanStatusFromSettled(null, { status: "rejected", reason: new Error("network") });
  assert.equal(resolved.known, false);
  assert.equal(resolved.stale, true);
});

test("resolveConfirmedSyncIssue ignores scan backlog style states", () => {
  assert.equal(resolveConfirmedSyncIssue({ scanBannerStatus: "truncated" }), false);
  assert.equal(resolveConfirmedSyncIssue({ scanBannerStatus: "paused" }), false);
});

test("resolveConfirmedSyncIssue detects reconnect and explicit failures", () => {
  assert.equal(resolveConfirmedSyncIssue({ reconnectRequired: true }), true);
  assert.equal(resolveConfirmedSyncIssue({ scanBannerStatus: "error" }), true);
  assert.equal(resolveConfirmedSyncIssue({ scanBannerStatus: "stale" }), true);
  assert.equal(resolveConfirmedSyncIssue({ scanBannerStatus: "partial", scanBannerErrors: 2 }), true);
});
