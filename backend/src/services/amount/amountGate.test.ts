import test from "node:test";
import assert from "node:assert/strict";

import type { MoneyDecision } from "./canonicalAmount.js";
import { ARC_VERSION } from "./canonicalAmount.js";
import {
  AMOUNT_GATE_VERSION,
  attachAmountGateToParsedFields,
  evaluateAmountGate,
  parseAmountGateFromParsedFields,
} from "./amountGate.js";

function baseMoneyDecision(overrides: Partial<MoneyDecision> = {}): MoneyDecision {
  return {
    selectedAmount: 250.5,
    amountBeforeVat: null,
    vatAmount: null,
    currency: "ILS",
    confidence: 0.9,
    evidenceScore: 2,
    reason: "Invoice total",
    reasonCode: "INVOICE_TOTAL",
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: ARC_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

test("null amount gate review blocks payment path", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({ selectedAmount: null, status: "missing", reasonCode: "MISSING" }),
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.arc_missing");
  assert.equal(gate.normalizedAmount, null);
});

test("zero amount gate review", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({ selectedAmount: 0, status: "resolved" }),
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.zero");
});

test("ambiguous ARC blocks payment", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({
      selectedAmount: null,
      status: "ambiguous",
      reasonCode: "DECIMAL_SHIFT",
    }),
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.decimal_shift");
});

test("resolved valid amount passes gate", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({ selectedAmount: 1180, status: "resolved", reasonCode: "INVOICE_TOTAL" }),
  });
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.reasonCode, "amount.resolved");
  assert.equal(gate.normalizedAmount, 1180);
  assert.equal(gate.engineVersion, AMOUNT_GATE_VERSION);
});

test("weird decimals normalized and reviewed", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({ selectedAmount: 123.456789, status: "resolved" }),
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.weird_decimals");
  assert.equal(gate.normalizedAmount, 123.46);
});

test("valid amount with two-decimal precision passes", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({ selectedAmount: 123.46, status: "resolved" }),
  });
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.normalizedAmount, 123.46);
});

test("VAT mismatch from FSE forces review", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({ selectedAmount: 500, status: "resolved" }),
    fseSummary: {
      warnings: [{ ruleId: "vat_arithmetic" }],
    },
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.vat_mismatch");
});

test("source conflict ARC status blocks payment", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({
      selectedAmount: null,
      status: "ambiguous",
      reasonCode: "SOURCE_CONFLICT",
    }),
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.source_conflict");
});

test("threshold exceeded blocks payment", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({
      selectedAmount: 1_000_000,
      status: "resolved",
    }),
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "amount.threshold_exceeded");
});

test("gate snapshot stored on parsedFieldsJson.gates", () => {
  const parsedFieldsJson: Record<string, unknown> = {};
  const snapshot = attachAmountGateToParsedFields(parsedFieldsJson, {
    moneyDecision: baseMoneyDecision(),
  });
  assert.equal(Array.isArray(parsedFieldsJson.gates), true);
  assert.equal((parsedFieldsJson.gates as unknown[]).length, 1);
  assert.equal(parseAmountGateFromParsedFields(parsedFieldsJson)?.verdict, "pass");
  assert.equal((parsedFieldsJson.gates as Array<{ gate: string }>)[0]?.gate, "amount");
});

test("existing valid Gmail invoice amount still passes gate", () => {
  const gate = evaluateAmountGate({
    moneyDecision: baseMoneyDecision({
      selectedAmount: 65,
      status: "resolved",
      reasonCode: "REGEX_LABELED",
      confidence: 0.88,
    }),
    fseSummary: {
      errors: [],
      warnings: [],
    },
  });
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.normalizedAmount, 65);
});
