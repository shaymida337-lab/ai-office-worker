import test from "node:test";
import assert from "node:assert/strict";

import {
  SCANNER_DECISION_BUCKETS,
  SCANNER_PIPELINE_STAGES,
  SCANNER_REVIEW_STATUSES,
  SCANNER_STAGE_STATUSES,
  isScannerDecisionBucket,
  isScannerPipelineStage,
  isScannerReviewStatus,
  isScannerStageStatus,
  normalizeDecisionBucket,
  normalizeReviewStatus,
  normalizeScannerStageStatus,
} from "./scannerStageTypes.js";

test("scanner pipeline stage enums are stable", () => {
  assert.deepEqual(SCANNER_PIPELINE_STAGES, [
    "ingestion",
    "classification",
    "extraction",
    "decision",
    "persistence",
  ]);
  assert.equal(SCANNER_STAGE_STATUSES.length, 7);
  assert.equal(SCANNER_REVIEW_STATUSES.length, 6);
  assert.equal(SCANNER_DECISION_BUCKETS.length, 7);
});

test("enum validators accept approved values and reject unknown values", () => {
  assert.equal(isScannerPipelineStage("ingestion"), true);
  assert.equal(isScannerPipelineStage("bogus"), false);
  assert.equal(isScannerStageStatus("success"), true);
  assert.equal(isScannerStageStatus("bogus"), false);
  assert.equal(isScannerReviewStatus("needs_review"), true);
  assert.equal(isScannerReviewStatus("bogus"), false);
  assert.equal(isScannerDecisionBucket("auto_save"), true);
  assert.equal(isScannerDecisionBucket("bogus"), false);
});

test("normalizeReviewStatus maps raw review statuses", () => {
  assert.equal(normalizeReviewStatus("auto_saved"), "auto_saved");
  assert.equal(normalizeReviewStatus("AUTO_SAVED"), "auto_saved");
  assert.equal(normalizeReviewStatus("needs_review"), "needs_review");
  assert.equal(normalizeReviewStatus("rejected"), "rejected");
  assert.equal(normalizeReviewStatus("unsupported_drive_link"), "unsupported");
  assert.equal(normalizeReviewStatus(null), "unknown");
  assert.equal(normalizeReviewStatus("   "), "unknown");
});

test("normalizeDecisionBucket maps auto_saved to auto_save", () => {
  assert.equal(normalizeDecisionBucket({ reviewStatus: "auto_saved" }), "auto_save");
});

test("normalizeDecisionBucket maps needs_review to needs_review", () => {
  assert.equal(normalizeDecisionBucket({ reviewStatus: "needs_review" }), "needs_review");
  assert.equal(
    normalizeDecisionBucket({ reviewStatus: "needs_review", outcomeStatus: "NEEDS_REVIEW" }),
    "needs_review",
  );
});

test("normalizeDecisionBucket maps rejected to rejected", () => {
  assert.equal(normalizeDecisionBucket({ reviewStatus: "rejected" }), "rejected");
  assert.equal(normalizeDecisionBucket({ outcomeStatus: "NOT_FINANCIAL" }), "rejected");
});

test("normalizeDecisionBucket maps duplicate outcome to duplicate", () => {
  assert.equal(normalizeDecisionBucket({ outcomeStatus: "DUPLICATE" }), "duplicate");
  assert.equal(
    normalizeDecisionBucket({ reviewStatus: "needs_review", outcomeStatus: "duplicate" }),
    "duplicate",
  );
});

test("normalizeDecisionBucket maps blocked outcome to blocked", () => {
  assert.equal(normalizeDecisionBucket({ outcomeStatus: "BLOCKED" }), "blocked");
  assert.equal(
    normalizeDecisionBucket({
      reviewStatus: "needs_review",
      outcomeStatus: "BLOCKED",
      reasonCode: "OE_TRUST_BLOCKED",
    }),
    "blocked",
  );
});

test("normalizeDecisionBucket maps drive_link.unsupported to unsupported", () => {
  assert.equal(
    normalizeDecisionBucket({ uncertaintyReason: "drive_link.unsupported" }),
    "unsupported",
  );
  assert.equal(
    normalizeDecisionBucket({ reasonCode: "drive_link.unsupported" }),
    "unsupported",
  );
  assert.equal(
    normalizeDecisionBucket({
      reviewStatus: "needs_review",
      uncertaintyReason: "Blocked: drive_link.unsupported: no readable file",
    }),
    "unsupported",
  );
});

test("normalizeDecisionBucket maps unknown and null to unknown", () => {
  assert.equal(normalizeDecisionBucket(null), "unknown");
  assert.equal(normalizeDecisionBucket(undefined), "unknown");
  assert.equal(normalizeDecisionBucket({}), "unknown");
  assert.equal(normalizeDecisionBucket({ reviewStatus: "mystery_status" }), "unknown");
});

test("normalizeDecisionBucket precedence: unsupported beats blocked and needs_review", () => {
  assert.equal(
    normalizeDecisionBucket({
      reviewStatus: "needs_review",
      outcomeStatus: "BLOCKED",
      uncertaintyReason: "drive_link.unsupported",
    }),
    "unsupported",
  );
});

test("normalizeDecisionBucket precedence: duplicate beats needs_review", () => {
  assert.equal(
    normalizeDecisionBucket({
      reviewStatus: "needs_review",
      outcomeStatus: "DUPLICATE",
    }),
    "duplicate",
  );
});

test("normalizeScannerStageStatus maps common stage aliases", () => {
  assert.equal(normalizeScannerStageStatus("success"), "success");
  assert.equal(normalizeScannerStageStatus("completed"), "success");
  assert.equal(normalizeScannerStageStatus("failed"), "failed");
  assert.equal(normalizeScannerStageStatus("skipped"), "skipped");
  assert.equal(normalizeScannerStageStatus(null), "unknown");
});
