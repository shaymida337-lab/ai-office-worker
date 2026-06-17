import test from "node:test";
import assert from "node:assert/strict";
import { supplierPaymentPersistenceDecision } from "./gmail-sync.js";

test("supplier payment with real amount still appends to sheet", () => {
  const decision = supplierPaymentPersistenceDecision({
    amount: 65,
    finalTotalAmount: null,
    needsReview: false,
  });

  assert.equal(decision.paymentAmount, 65);
  assert.equal(decision.approvalStatus, "approved");
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.shouldAppendToSheet, true);
});

test("missing-amount needs_review supplier payment is created but not appended to sheet", () => {
  const decision = supplierPaymentPersistenceDecision({
    amount: null,
    finalTotalAmount: null,
    needsReview: true,
  });

  assert.equal(decision.paymentAmount, 0);
  assert.equal(decision.approvalStatus, "needs_review");
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.shouldAppendToSheet, false);
});

test("needs_review supplier payment with real amount still appends to sheet", () => {
  const decision = supplierPaymentPersistenceDecision({
    amount: 992.69,
    finalTotalAmount: null,
    needsReview: true,
  });

  assert.equal(decision.paymentAmount, 992.69);
  assert.equal(decision.approvalStatus, "needs_review");
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.shouldAppendToSheet, true);
});
