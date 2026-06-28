import test from "node:test";
import assert from "node:assert/strict";

import {
  FINANCE_AMOUNT_MISSING_LABEL,
  FINANCE_AMOUNT_REVIEW_LABEL,
  FINANCE_AMOUNT_UNRESOLVED_REASON,
  formatFinanceAmountLabel,
  isCanonicalFinanceAmountResolved,
  resolveCanonicalFinanceAmount,
  resolveFinanceDisplayAmount,
} from "./financeDisplayAmount.js";
import { evaluateAmountGate } from "./amountGate.js";
import { supplierPaymentPersistenceDecision, buildPassingTrustGateSnapshots } from "../trust/trustGatePersistence.js";
import { ARC_VERSION } from "./canonicalAmount.js";

test("null amount does not display as zero", () => {
  const display = resolveFinanceDisplayAmount({ totalAmount: null, parsedFieldsJson: { amount: 120 } });
  assert.equal(display.amount, null);
  assert.notEqual(display.amountLabel, "₪0");
  assert.equal(display.amountLabel, FINANCE_AMOUNT_MISSING_LABEL);
  assert.equal(display.resolved, false);
});

test("unresolved amount returns סכום חסר label", () => {
  const display = resolveFinanceDisplayAmount({
    totalAmount: null,
    parsedFieldsJson: { arc: { status: "ambiguous", selectedAmount: null, reasonCode: "AMBIGUOUS" } },
  });
  assert.equal(display.amountLabel, "סכום חסר");
  assert.equal(display.arcStatus, "ambiguous");
});

test("resolved totalAmount is canonical and formatted to 2 decimals", () => {
  const display = resolveFinanceDisplayAmount({
    totalAmount: 123.456,
    currency: "ILS",
    parsedFieldsJson: { arc: { status: "resolved", selectedAmount: 123.456, reasonCode: "INVOICE_TOTAL" } },
  });
  assert.equal(display.amount, 123.46);
  assert.equal(display.amountLabel, "₪123.46");
  assert.equal(display.resolved, true);
});

test("regex parsed_fields_json.amount alone is not used for display", () => {
  const amount = resolveCanonicalFinanceAmount({
    totalAmount: null,
    parsedFieldsJson: { amount: 999, arc: { status: "missing", selectedAmount: null } },
  });
  assert.equal(amount, null);
});

test("amount gate review with VAT mismatch shows דורש בדיקה", () => {
  const display = resolveFinanceDisplayAmount({
    totalAmount: 500,
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 500, reasonCode: "INVOICE_TOTAL" },
      gates: [
        {
          gate: "amount",
          verdict: "review",
          reasonCode: "amount.vat_mismatch",
          engineVersion: "amount-gate-v1",
          normalizedAmount: 500,
        },
      ],
    },
  });
  assert.equal(display.amount, null);
  assert.equal(display.amountLabel, FINANCE_AMOUNT_REVIEW_LABEL);
  assert.equal(display.resolved, false);
});

test("payment blocked when amount gate does not pass", () => {
  const gate = evaluateAmountGate({
    moneyDecision: {
      selectedAmount: null,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0,
      evidenceScore: 0,
      reason: "missing",
      reasonCode: "MISSING",
      candidates: [],
      rejected: [],
      status: "missing",
      ambiguityFlags: [],
      version: ARC_VERSION,
      isStrongEnoughForAutoSave: false,
    },
  });
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: null,
    needsReview: false,
    amountGate: gate,
    ...buildPassingTrustGateSnapshots({ amountGate: gate }),
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, "amount.arc_missing");
});

test("payment is not created when amount missing or zero without passing gates", () => {
  for (const selectedAmount of [null, undefined, 0, -1, Number.NaN]) {
    const decision = supplierPaymentPersistenceDecision({
      selectedAmount,
      needsReview: false,
      ...buildPassingTrustGateSnapshots(),
    });
    assert.equal(decision.shouldCreatePayment, false, String(selectedAmount));
    assert.equal(decision.blockReason, FINANCE_AMOUNT_UNRESOLVED_REASON);
    assert.equal(decision.paymentAmount, null);
  }
});

test("payment is not created when trust gates are missing", () => {
  const decision = supplierPaymentPersistenceDecision({ selectedAmount: 250.5, needsReview: false });
  assert.equal(decision.shouldCreatePayment, false);
  assert.match(decision.blockReason ?? "", /^trust\./);
});

test("valid invoice amount still creates payment when all gates pass", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 250.5,
    needsReview: false,
    ...buildPassingTrustGateSnapshots(),
  });
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.paymentAmount, 250.5);
  assert.equal(decision.blockReason, null);
  assert.equal(decision.approvalStatus, "approved");
});

test("needs_review payment with valid amount still creates payment row when gates pass", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: true,
    ...buildPassingTrustGateSnapshots(),
  });
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.approvalStatus, "needs_review");
  assert.equal(decision.shouldAppendToSheet, false);
});

test("isCanonicalFinanceAmountResolved rejects non-positive values", () => {
  assert.equal(isCanonicalFinanceAmountResolved(null), false);
  assert.equal(isCanonicalFinanceAmountResolved(0), false);
  assert.equal(isCanonicalFinanceAmountResolved(0.01), true);
});

test("formatFinanceAmountLabel uses missing label for null", () => {
  assert.equal(formatFinanceAmountLabel(null), FINANCE_AMOUNT_MISSING_LABEL);
});
