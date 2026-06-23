import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVerificationQueryString,
  formatVerificationPercent,
  verificationBadgeTone,
} from "./verificationCenterFormat.js";

test("verification format: percent and badge tone", () => {
  assert.equal(formatVerificationPercent(0.91), "91%");
  assert.equal(formatVerificationPercent(null), "—");
  assert.equal(
    verificationBadgeTone({ outcomeStatus: "SAVED", reviewStatus: "auto_saved" }),
    "saved"
  );
  assert.equal(
    verificationBadgeTone({ outcomeStatus: "DUPLICATE", reviewStatus: "duplicate" }),
    "duplicate"
  );
  assert.equal(
    verificationBadgeTone({ outcomeStatus: "NOT_FINANCIAL", reviewStatus: "needs_review" }),
    "notFinancial"
  );
});

test("verification format: buildVerificationQueryString", () => {
  const query = buildVerificationQueryString({
    days: "30",
    limit: "25",
    outcome: "SAVED",
    review: "",
    supplier: "resolved",
    blocked: true,
    duplicate: false,
    confidence: "high",
    search: "acme",
  });
  assert.match(query, /days=30/);
  assert.match(query, /outcome=SAVED/);
  assert.match(query, /supplier=resolved/);
  assert.match(query, /blocked=true/);
  assert.match(query, /search=acme/);
});
