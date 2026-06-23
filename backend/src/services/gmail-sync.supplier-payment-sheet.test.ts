import test from "node:test";
import assert from "node:assert/strict";
import { supplierPaymentPersistenceDecision } from "./gmail-sync.js";

test("supplier payment with real amount still appends to sheet", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 65,
    needsReview: false,
  });

  assert.equal(decision.paymentAmount, 65);
  assert.equal(decision.approvalStatus, "approved");
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.shouldAppendToSheet, true);
});

test("missing-amount supplier payment is not created silently as zero", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: null,
    needsReview: true,
  });

  assert.equal(decision.paymentAmount, null);
  assert.equal(decision.approvalStatus, "needs_review");
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.shouldAppendToSheet, false);
});

test("needs_review supplier payment with amount still skips sheet append", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: true,
  });

  assert.equal(decision.paymentAmount, 120);
  assert.equal(decision.approvalStatus, "needs_review");
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.shouldAppendToSheet, false);
});
