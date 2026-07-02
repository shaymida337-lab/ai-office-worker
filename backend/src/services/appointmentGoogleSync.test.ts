import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateGoogleSyncBackoffMs,
  isRetryEligible,
  normalizeGoogleSyncError,
  resolveGoogleSyncFailurePlan,
} from "./appointmentGoogleSync.js";
import { GoogleCalendarSyncError } from "./google.js";

test("calculateGoogleSyncBackoffMs returns staged delays and dead-letter null", () => {
  assert.equal(calculateGoogleSyncBackoffMs(1), 5_000);
  assert.equal(calculateGoogleSyncBackoffMs(2), 30_000);
  assert.equal(calculateGoogleSyncBackoffMs(3), 120_000);
  assert.equal(calculateGoogleSyncBackoffMs(4), 600_000);
  assert.equal(calculateGoogleSyncBackoffMs(5), null);
});

test("isRetryEligible honors status, attempts and next retry time", () => {
  const now = new Date("2026-07-02T10:00:00.000Z");
  assert.equal(
    isRetryEligible({
      status: "retrying",
      attemptCount: 2,
      nextRetryAt: new Date("2026-07-02T09:59:59.000Z"),
      now,
    }),
    true
  );
  assert.equal(
    isRetryEligible({
      status: "retrying",
      attemptCount: 4,
      nextRetryAt: new Date("2026-07-02T09:59:59.000Z"),
      now,
    }),
    false
  );
  assert.equal(
    isRetryEligible({
      status: "synced",
      attemptCount: 1,
      nextRetryAt: null,
      now,
    }),
    false
  );
});

test("resolveGoogleSyncFailurePlan transitions retrying to failed at max attempts", () => {
  const now = new Date("2026-07-02T10:00:00.000Z");
  const retrying = resolveGoogleSyncFailurePlan(2, now);
  assert.equal(retrying.status, "retrying");
  assert.ok(retrying.nextRetryAt instanceof Date);

  const deadLetter = resolveGoogleSyncFailurePlan(5, now);
  assert.equal(deadLetter.status, "failed");
  assert.equal(deadLetter.nextRetryAt, null);
});

test("normalizeGoogleSyncError formats typed and generic errors", () => {
  const typed = new GoogleCalendarSyncError("google_api_error", "boom", 503);
  assert.match(normalizeGoogleSyncError(typed), /google_api_error: boom \(status=503\)/);
  assert.equal(normalizeGoogleSyncError(new Error("plain")), "plain");
});

