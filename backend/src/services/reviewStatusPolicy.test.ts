import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_REVIEW_STATUSES,
  GMAIL_SCAN_ITEM_STATUSES,
  presentedReviewStatus,
  reviewCandidateStatusesForTab,
  reviewTabForStatus,
} from "./reviewStatusPolicy.js";

// ─── הטסטים שמקבעים את המדיניות: כל סטטוס מופיע בדיוק במקום אחד, תמיד ───

test("policy: every GmailScanItem status has exactly one home tab", () => {
  assert.equal(reviewTabForStatus("auto_saved"), "approved");   // המערכת אישרה אוטומטית → "מאושר"
  assert.equal(reviewTabForStatus("approved"), "approved");     // אישור ידני → "מאושר"
  assert.equal(reviewTabForStatus("needs_review"), "needs_review");
  for (const status of GMAIL_SCAN_ITEM_STATUSES) {
    const tab = reviewTabForStatus(status);
    assert.notEqual(tab, "mirror_of_payment", `GSI status ${status} must be visible in a tab`);
  }
});

test("policy: every FinancialDocumentReview status has exactly one home", () => {
  assert.equal(reviewTabForStatus("approved"), "approved");
  assert.equal(reviewTabForStatus("needs_review"), "needs_review");
  assert.equal(reviewTabForStatus("rejected"), "rejected");
  // duplicate = מראה של תשלום קיים — המסמך מיוצג ע"י רשומת התשלום (לא תצוגה כפולה)
  assert.equal(reviewTabForStatus("duplicate"), "mirror_of_payment");
  for (const status of DOCUMENT_REVIEW_STATUSES) {
    assert.ok(reviewTabForStatus(status), `FDR status ${status} must map somewhere`);
  }
});

test("policy: unknown or missing status never disappears — falls to needs_review", () => {
  assert.equal(reviewTabForStatus("some_future_status"), "needs_review");
  assert.equal(reviewTabForStatus(""), "needs_review");
  assert.equal(reviewTabForStatus(null), "needs_review");
  assert.equal(reviewTabForStatus(undefined), "needs_review");
});

test("policy: approved tab query loads both approved and auto_saved (the original bug)", () => {
  assert.deepEqual(reviewCandidateStatusesForTab("approved"), ["approved", "auto_saved"]);
  assert.deepEqual(reviewCandidateStatusesForTab("needs_review"), ["needs_review"]);
  assert.deepEqual(reviewCandidateStatusesForTab("rejected"), ["rejected"]);
});

test("policy: the no-tab (all) query covers every visible status — nothing filtered to nowhere", () => {
  const all = reviewCandidateStatusesForTab(undefined)!;
  for (const status of GMAIL_SCAN_ITEM_STATUSES) {
    assert.ok(all.includes(status), `all-tab must load GSI status ${status}`);
  }
  for (const status of DOCUMENT_REVIEW_STATUSES) {
    if (reviewTabForStatus(status) === "mirror_of_payment") continue; // מיוצג ע"י התשלום
    assert.ok(all.includes(status), `all-tab must load FDR status ${status}`);
  }
});

test("policy: auto_saved is PRESENTED as approved — no new tab, no new term for the user", () => {
  assert.equal(presentedReviewStatus("auto_saved"), "approved");
  assert.equal(presentedReviewStatus("approved"), "approved");
  assert.equal(presentedReviewStatus("needs_review"), "needs_review");
  assert.equal(presentedReviewStatus("rejected"), "rejected");
  assert.equal(presentedReviewStatus(null), "needs_review");
});
