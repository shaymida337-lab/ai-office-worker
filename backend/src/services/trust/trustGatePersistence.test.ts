import test from "node:test";
import assert from "node:assert/strict";

import {
  TRUST_AMOUNT_GATE_MISSING,
  TRUST_DUPLICATE_GATE_MISSING,
  TRUST_FINGERPRINT_GATE_MISSING,
  TRUST_SUPPLIER_GATE_MISSING,
  amountGateAllowsManualApproval,
  allTrustGatesPass,
  buildPassingTrustGateSnapshots,
  parseTrustGatesFromParsedFields,
  supplierPaymentPersistenceDecision,
  trustGatesFailClosedReason,
} from "./trustGatePersistence.js";

test("supplierPaymentPersistenceDecision fails closed when amount gate missing", () => {
  const gates = buildPassingTrustGateSnapshots();
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    supplierGate: gates.supplierGate,
    fingerprintGate: gates.fingerprintGate,
    duplicateGate: gates.duplicateGate,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, TRUST_AMOUNT_GATE_MISSING);
});

test("supplierPaymentPersistenceDecision fails closed when supplier gate missing", () => {
  const gates = buildPassingTrustGateSnapshots();
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    amountGate: gates.amountGate,
    fingerprintGate: gates.fingerprintGate,
    duplicateGate: gates.duplicateGate,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, TRUST_SUPPLIER_GATE_MISSING);
});

test("supplierPaymentPersistenceDecision fails closed when fingerprint gate missing", () => {
  const gates = buildPassingTrustGateSnapshots();
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    amountGate: gates.amountGate,
    supplierGate: gates.supplierGate,
    duplicateGate: gates.duplicateGate,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, TRUST_FINGERPRINT_GATE_MISSING);
});

test("supplierPaymentPersistenceDecision fails closed when duplicate gate missing", () => {
  const gates = buildPassingTrustGateSnapshots();
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    amountGate: gates.amountGate,
    supplierGate: gates.supplierGate,
    fingerprintGate: gates.fingerprintGate,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, TRUST_DUPLICATE_GATE_MISSING);
});

test("supplierPaymentPersistenceDecision blocks when any gate is review", () => {
  const gates = buildPassingTrustGateSnapshots({
    fingerprintGate: { verdict: "review", reasonCode: "fingerprint.weak_tier" },
  });
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    ...gates,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, "fingerprint.weak_tier");
});

test("supplierPaymentPersistenceDecision allows payment when all gates pass", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    ...buildPassingTrustGateSnapshots(),
  });
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.blockReason, null);
});

test("drive recovery style parse blocks when gates missing from parsedFieldsJson", () => {
  const parsed = parseTrustGatesFromParsedFields({});
  assert.equal(trustGatesFailClosedReason(parsed), TRUST_AMOUNT_GATE_MISSING);
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 65,
    needsReview: false,
    ...parsed,
  });
  assert.equal(decision.shouldCreatePayment, false);
});

test("duplicate MATCH does not promote approval without gates PASS", () => {
  assert.equal(allTrustGatesPass(parseTrustGatesFromParsedFields({})), false);
  assert.equal(allTrustGatesPass(buildPassingTrustGateSnapshots()), true);
});

test("amountGateAllowsManualApproval blocks ambiguous arc", () => {
  const approval = amountGateAllowsManualApproval({
    totalAmount: 120,
    parsedFieldsJson: {
      arc: { status: "ambiguous", selectedAmount: 120, reasonCode: "AMBIGUOUS" },
    },
  });
  assert.equal(approval.allowed, false);
});

test("amountGateAllowsManualApproval passes resolved total", () => {
  const approval = amountGateAllowsManualApproval({
    totalAmount: 120,
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 120, reasonCode: "INVOICE_TOTAL" },
    },
  });
  assert.equal(approval.allowed, true);
});
