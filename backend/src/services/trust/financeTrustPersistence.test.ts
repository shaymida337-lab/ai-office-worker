import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeCanonicalFingerprint } from "../dedup/sharedMatcher.js";
import {
  DUPLICATE_GATE_VERSION,
  evaluateDuplicateGate,
  type DuplicateGateInput,
} from "../dedup/duplicateGate.js";
import {
  FINGERPRINT_GATE_VERSION,
  evaluateFingerprintGate,
  type FingerprintGateInput,
} from "../dedup/fingerprintGate.js";
import { AMOUNT_GATE_VERSION } from "../amount/amountGate.js";
import { SUPPLIER_GATE_VERSION } from "../supplier/supplierGate.js";
import {
  buildPassingTrustGateSnapshots,
  TRUST_AMOUNT_GATE_MISSING,
  TRUST_DUPLICATE_GATE_MISSING,
  TRUST_FINGERPRINT_GATE_MISSING,
  TRUST_SUPPLIER_GATE_MISSING,
} from "./trustGatePersistence.js";
import {
  evaluateFinanceTrustGates,
  evaluateFreshTrustGatesForManualApproval,
  financeIngestionPathsForStaticGuard,
  FINANCE_TRUST_PERSISTENCE_MODULE,
  requireAllFinanceGatesPass,
} from "./financeTrustPersistence.js";

const backendRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function passingFingerprintInput(): FingerprintGateInput {
  const scfc = computeCanonicalFingerprint({
    organizationId: "org-1",
    supplierName: "Acme Supplies",
    supplierTaxId: "123456789",
    invoiceNumber: "INV-100",
    totalAmount: 120,
    documentDate: "2025-01-15",
    documentType: "tax_invoice",
  });
  return {
    scfc,
    documentFingerprint: scfc.fingerprint,
  };
}

function passingDuplicateInput(): DuplicateGateInput {
  return {
    matchResult: "NONE",
    documentFingerprint: "scfc-v1:test-fingerprint",
  };
}

test("all four gates PASS → payment created eligibility", () => {
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...buildPassingTrustGateSnapshots(),
    documentType: "tax_invoice",
    confidenceScore: 0.9,
  });
  assert.equal(evaluation.outcome, "pass");
  assert.equal(evaluation.shouldCreatePayment, true);
  assert.equal(requireAllFinanceGatesPass(evaluation.gates), true);
});

test("Amount REVIEW → no payment", () => {
  const gates = buildPassingTrustGateSnapshots({
    amountGate: { verdict: "review", reasonCode: "amount.ambiguous" },
  });
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...gates,
  });
  assert.equal(evaluation.outcome, "review");
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, "amount.ambiguous");
});

test("Supplier REVIEW → no payment", () => {
  const gates = buildPassingTrustGateSnapshots({
    supplierGate: { verdict: "review", reasonCode: "supplier.weak" },
  });
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...gates,
  });
  assert.equal(evaluation.outcome, "review");
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, "supplier.weak");
});

test("Fingerprint REVIEW → no payment", () => {
  const gates = buildPassingTrustGateSnapshots({
    fingerprintGate: { verdict: "review", reasonCode: "fingerprint.weak_tier" },
  });
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...gates,
  });
  assert.equal(evaluation.outcome, "review");
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, "fingerprint.weak_tier");
});

test("Duplicate REVIEW → no payment", () => {
  const gates = buildPassingTrustGateSnapshots({
    duplicateGate: { verdict: "review", reasonCode: "duplicate.semantic_unsure" },
  });
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...gates,
  });
  assert.equal(evaluation.outcome, "review");
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, "duplicate.semantic_unsure");
});

test("Duplicate BLOCK → no payment", () => {
  const gates = buildPassingTrustGateSnapshots({
    duplicateGate: {
      verdict: "block",
      reasonCode: "duplicate.confirmed_match",
      matchedPaymentId: "pay-1",
      matchStrength: "confirmed",
    },
  });
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    ...gates,
  });
  assert.equal(evaluation.outcome, "block");
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, "duplicate.confirmed_match");
});

test("Missing gate snapshot → no payment", () => {
  const evaluation = evaluateFinanceTrustGates({
    selectedAmount: 120,
    needsReview: false,
    parsedFieldsJson: {},
  });
  assert.equal(evaluation.outcome, "review");
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, TRUST_AMOUNT_GATE_MISSING);
});

test("WhatsApp-style missing gates remains review-only", () => {
  const evaluation = evaluateFinanceTrustGates({
    parsedFieldsJson: {},
    selectedAmount: 250,
    needsReview: false,
    documentType: "tax_invoice",
    confidenceScore: 0.95,
  });
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, TRUST_AMOUNT_GATE_MISSING);
});

test("Client Gmail-style empty parsedFields remains review-only", () => {
  const evaluation = evaluateFinanceTrustGates({
    parsedFieldsJson: {},
    selectedAmount: 100,
    documentType: "tax_invoice",
    confidenceScore: 0.5,
  });
  assert.equal(evaluation.shouldCreatePayment, false);
});

test("Camera-style low confidence remains review-only", () => {
  const evaluation = evaluateFinanceTrustGates({
    ...buildPassingTrustGateSnapshots(),
    selectedAmount: 80,
    needsReview: false,
    documentType: "tax_invoice",
    confidenceScore: 0.4,
  });
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.match(evaluation.reasonCode ?? "", /confidence below 80%/);
});

test("Manual approve uses unified fresh gate evaluation", () => {
  const snapshots = buildPassingTrustGateSnapshots();
  const evaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 120, reasonCode: "INVOICE_TOTAL" },
      sir: {
        supplierName: "Acme Supplies",
        canonicalSupplier: "Acme Supplies",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
      },
      gates: [
        snapshots.amountGate,
        snapshots.supplierGate,
        snapshots.fingerprintGate,
        snapshots.duplicateGate,
      ],
    },
    totalAmount: 120,
    supplierName: "Acme Supplies",
    fingerprintGateInput: passingFingerprintInput(),
    duplicateGateInput: passingDuplicateInput(),
  });
  assert.equal(evaluation.outcome, "pass");
  assert.equal(evaluation.shouldCreatePayment, true);
  assert.equal(evaluation.gates.amountGate?.engineVersion, AMOUNT_GATE_VERSION);
  assert.equal(evaluation.gates.supplierGate?.engineVersion, SUPPLIER_GATE_VERSION);
  assert.equal(evaluation.gates.fingerprintGate?.engineVersion, FINGERPRINT_GATE_VERSION);
  assert.equal(evaluation.gates.duplicateGate?.engineVersion, DUPLICATE_GATE_VERSION);
});

test("Manual approve blocks duplicate MATCH via unified gate", () => {
  const evaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: {
      arc: { status: "resolved", selectedAmount: 120, reasonCode: "INVOICE_TOTAL" },
      sir: {
        supplierName: "Acme Supplies",
        canonicalSupplier: "Acme Supplies",
        status: "resolved",
        isStrongEnoughForAutoSave: true,
      },
    },
    totalAmount: 120,
    supplierName: "Acme Supplies",
    fingerprintGateInput: passingFingerprintInput(),
    duplicateGateInput: {
      matchResult: "MATCH",
      matchReasons: ["fingerprint_match"],
      matchedCandidate: { id: "existing-pay" },
      documentFingerprint: "scfc-v1:test-fingerprint",
    },
  });
  assert.equal(evaluation.outcome, "block");
  assert.equal(evaluation.shouldCreatePayment, false);
  assert.equal(evaluation.reasonCode, "duplicate.confirmed_match");
});

test("parsedFieldsJson gates includes all four gate snapshots", () => {
  const snapshots = buildPassingTrustGateSnapshots();
  const parsed = {
    gates: [
      snapshots.amountGate,
      snapshots.supplierGate,
      snapshots.fingerprintGate,
      snapshots.duplicateGate,
    ],
  };
  const evaluation = evaluateFinanceTrustGates({
    parsedFieldsJson: parsed,
    selectedAmount: 65,
    needsReview: false,
    documentType: "tax_invoice",
    confidenceScore: 0.9,
  });
  assert.equal(evaluation.outcome, "pass");
  assert.equal(evaluation.gates.amountGate?.verdict, "pass");
  assert.equal(evaluation.gates.supplierGate?.verdict, "pass");
  assert.equal(evaluation.gates.fingerprintGate?.verdict, "pass");
  assert.equal(evaluation.gates.duplicateGate?.verdict, "pass");
});

test("static guard catches direct supplierPayment.create outside unified module", () => {
  const forbiddenPattern = /\bprisma\.supplierPayment\.create\s*\(/;
  const allowedRelativePaths = new Set([
    FINANCE_TRUST_PERSISTENCE_MODULE,
  ]);

  const violations: string[] = [];
  for (const relativePath of financeIngestionPathsForStaticGuard()) {
    if (allowedRelativePaths.has(relativePath)) continue;
    const absolutePath = join(backendRoot, relativePath);
    const source = readFileSync(absolutePath, "utf8");
    if (forbiddenPattern.test(source)) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Direct prisma.supplierPayment.create found outside unified module: ${violations.join(", ")}`
  );
});

test("static guard allows unified module to own supplierPayment.create", () => {
  const modulePath = join(backendRoot, FINANCE_TRUST_PERSISTENCE_MODULE);
  const source = readFileSync(modulePath, "utf8");
  assert.match(source, /\bprisma\.supplierPayment\.create\s*\(/);
  assert.match(source, /\bprisma\.supplierPayment\.upsert\s*\(/);
});

test("evaluateFinanceTrustGates reports first failing gate in order", () => {
  const evaluation = evaluateFinanceTrustGates({
    amountGate: buildPassingTrustGateSnapshots().amountGate,
    supplierGate: null,
    fingerprintGate: buildPassingTrustGateSnapshots().fingerprintGate,
    duplicateGate: buildPassingTrustGateSnapshots().duplicateGate,
    selectedAmount: 50,
    needsReview: false,
  });
  assert.equal(evaluation.reasonCode, TRUST_SUPPLIER_GATE_MISSING);
});

test("fresh gate evaluators produce expected duplicate and fingerprint snapshots", () => {
  const fingerprintGate = evaluateFingerprintGate(passingFingerprintInput());
  const duplicateGate = evaluateDuplicateGate(passingDuplicateInput());
  assert.equal(fingerprintGate.verdict, "pass");
  assert.equal(duplicateGate.verdict, "pass");
});
