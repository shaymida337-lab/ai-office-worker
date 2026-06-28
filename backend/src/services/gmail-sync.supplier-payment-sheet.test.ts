import test from "node:test";
import assert from "node:assert/strict";

import { supplierPaymentPersistenceDecision, buildPassingTrustGateSnapshots } from "./trust/trustGatePersistence.js";

test("supplier payment with real amount still appends to sheet when all gates pass", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 65,
    needsReview: false,
    ...buildPassingTrustGateSnapshots(),
  });

  assert.equal(decision.paymentAmount, 65);
  assert.equal(decision.approvalStatus, "approved");
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.shouldAppendToSheet, true);
  assert.equal(decision.blockReason, null);
});

test("missing-amount supplier payment is not created silently as zero", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: null,
    needsReview: true,
    ...buildPassingTrustGateSnapshots(),
  });

  assert.equal(decision.paymentAmount, null);
  assert.equal(decision.approvalStatus, "needs_review");
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.shouldAppendToSheet, false);
  assert.equal(decision.blockReason, "amount.unresolved");
});

test("zero-amount supplier payment is not created", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 0,
    needsReview: false,
    ...buildPassingTrustGateSnapshots(),
  });

  assert.equal(decision.paymentAmount, null);
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, "amount.unresolved");
});

test("needs_review supplier payment with amount still skips sheet append when gates pass", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: true,
    ...buildPassingTrustGateSnapshots(),
  });

  assert.equal(decision.paymentAmount, 120);
  assert.equal(decision.approvalStatus, "needs_review");
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.shouldAppendToSheet, false);
});

test("missing gates blocks payment even with valid amount", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 65,
    needsReview: false,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.match(decision.blockReason ?? "", /^trust\./);
});
