import test from "node:test";
import assert from "node:assert/strict";

import { computeCanonicalSupplier } from "./canonicalSupplier.js";
import {
  buildOcrKeywordSupplierCandidate,
  buildUserCorrectedSupplierCandidate,
} from "./supplierCandidates.js";
import {
  attachSupplierGateToParsedFields,
  evaluateSupplierGate,
  supplierGateAllowsManualApproval,
  supplierGatePasses,
} from "./supplierGate.js";
import type { SupplierDecision } from "./supplierTypes.js";
import { SIR_VERSION } from "./supplierTypes.js";
import { supplierPaymentPersistenceDecision } from "../trust/trustGatePersistence.js";
import { buildPassingTrustGateSnapshots } from "../trust/trustGatePersistence.js";
import { evaluateAmountGate } from "../amount/amountGate.js";
import { ARC_VERSION } from "../amount/canonicalAmount.js";

function baseSupplierDecision(overrides: Partial<SupplierDecision> = {}): SupplierDecision {
  return {
    supplierName: "OpenAI LLC",
    canonicalSupplier: "openai",
    normalizedName: "openai llc",
    vatNumber: null,
    domains: [],
    emails: [],
    phones: [],
    aliases: [],
    logo: null,
    confidence: 0.92,
    evidenceScore: 0.9,
    reason: "document labeled",
    reasonCode: "DOCUMENT_LABELED",
    evidence: [],
    candidates: [
      {
        name: "OpenAI LLC",
        kind: "document_labeled",
        source: "claude_file",
        tier: 90,
        score: 900,
        normalizedName: "openai llc",
      },
    ],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: SIR_VERSION,
    isStrongEnoughForAutoSave: true,
    ...overrides,
  };
}

test("placeholder לא זוהה is supplier gate REVIEW", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "לא זוהה",
      canonicalSupplier: null,
      status: "missing",
      reasonCode: "MISSING",
      isStrongEnoughForAutoSave: false,
      candidates: [],
    }),
    supplierName: "לא זוהה",
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "supplier.sir_missing");
});

test("placeholder לא ידוע is supplier gate REVIEW", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "לא ידוע",
      canonicalSupplier: null,
      status: "resolved",
      isStrongEnoughForAutoSave: false,
    }),
    supplierName: "לא ידוע",
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "supplier.placeholder_hebrew");
});

test("Current Address Details tokens are supplier gate REVIEW", () => {
  for (const name of ["Current", "Address", "Details"]) {
    const gate = evaluateSupplierGate({
      supplierDecision: baseSupplierDecision({ supplierName: name, canonicalSupplier: null }),
      supplierName: name,
    });
    assert.equal(gate.verdict, "review", name);
    assert.equal(gate.reasonCode, "supplier.placeholder_en", name);
  }
});

test("email or domain supplier is supplier gate REVIEW", () => {
  const emailGate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "billing@supplier.example.com",
      canonicalSupplier: null,
      status: "resolved",
      isStrongEnoughForAutoSave: false,
    }),
    supplierName: "billing@supplier.example.com",
  });
  assert.equal(emailGate.verdict, "review");
  assert.equal(emailGate.reasonCode, "supplier.email_or_domain");

  const domainGate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "supplier.example.com",
      canonicalSupplier: null,
    }),
    supplierName: "supplier.example.com",
  });
  assert.equal(domainGate.verdict, "review");
  assert.equal(domainGate.reasonCode, "supplier.email_or_domain");
});

test("phone or address supplier is supplier gate REVIEW", () => {
  const phoneGate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "0501234567",
      canonicalSupplier: null,
    }),
    supplierName: "0501234567",
  });
  assert.equal(phoneGate.verdict, "review");
  assert.equal(phoneGate.reasonCode, "supplier.phone_or_address");

  const addressGate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: "תל אביב, רחוב הרצל 12",
      canonicalSupplier: null,
    }),
    supplierName: "תל אביב, רחוב הרצל 12",
  });
  assert.equal(addressGate.verdict, "review");
  assert.equal(addressGate.reasonCode, "supplier.phone_or_address");
});

test("SIR ambiguous is supplier gate REVIEW", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: null,
      canonicalSupplier: null,
      status: "ambiguous",
      reasonCode: "AMBIGUOUS",
      isStrongEnoughForAutoSave: false,
      candidates: [],
    }),
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "supplier.sir_ambiguous");
});

test("SIR rejected is supplier gate BLOCK", () => {
  const gate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({
      supplierName: null,
      canonicalSupplier: "blocked-vendor",
      status: "rejected",
      reasonCode: "BLOCKLISTED",
      isStrongEnoughForAutoSave: false,
    }),
  });
  assert.equal(gate.verdict, "block");
  assert.equal(gate.reasonCode, "supplier.not_supplier");
});

test("valid resolved supplier passes supplier gate", () => {
  const gate = evaluateSupplierGate({ supplierDecision: baseSupplierDecision() });
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.reasonCode, "supplier.resolved");
  assert.equal(gate.canonicalSupplierName, "openai");
  assert.equal(supplierGatePasses(gate), true);
});

test("amount pass and supplier pass allow payment creation", () => {
  const amountGate = evaluateAmountGate({
    moneyDecision: {
      selectedAmount: 65,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.9,
      evidenceScore: 2,
      reason: "invoice total",
      reasonCode: "INVOICE_TOTAL",
      candidates: [],
      rejected: [],
      status: "resolved",
      ambiguityFlags: [],
      version: ARC_VERSION,
      isStrongEnoughForAutoSave: true,
    },
  });
  const supplierGate = evaluateSupplierGate({ supplierDecision: baseSupplierDecision() });
  const passingGates = buildPassingTrustGateSnapshots();
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 65,
    needsReview: false,
    amountGate,
    supplierGate,
    fingerprintGate: passingGates.fingerprintGate,
    duplicateGate: passingGates.duplicateGate,
  });
  assert.equal(decision.shouldCreatePayment, true);
  assert.equal(decision.blockReason, null);
});

test("supplier gate REVIEW blocks payment even when amount passes", () => {
  const amountGate = evaluateAmountGate({
    moneyDecision: {
      selectedAmount: 120,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.9,
      evidenceScore: 2,
      reason: "invoice total",
      reasonCode: "INVOICE_TOTAL",
      candidates: [],
      rejected: [],
      status: "resolved",
      ambiguityFlags: [],
      version: ARC_VERSION,
      isStrongEnoughForAutoSave: true,
    },
  });
  const supplierGate = evaluateSupplierGate({
    supplierDecision: baseSupplierDecision({ supplierName: "לא זוהה", canonicalSupplier: null, status: "missing" }),
    supplierName: "לא זוהה",
  });
  const passingGates = buildPassingTrustGateSnapshots();
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    amountGate,
    supplierGate,
    fingerprintGate: passingGates.fingerprintGate,
    duplicateGate: passingGates.duplicateGate,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.match(decision.blockReason ?? "", /^supplier\./);
});

test("manual approval blocked for placeholder supplier", () => {
  const approval = supplierGateAllowsManualApproval({
    sirSummary: {
      supplierName: "לא זוהה",
      status: "missing",
      reasonCode: "MISSING",
      isStrongEnoughForAutoSave: false,
    },
    supplierName: "לא זוהה",
  });
  assert.equal(approval.allowed, false);
  assert.ok(approval.reasonCode?.startsWith("supplier."));
});

test("existing valid Gmail supplier invoice still passes gate", () => {
  const decision = computeCanonicalSupplier({
    organizationId: "org-gmail",
    channel: "gmail",
    candidates: [
      buildOcrKeywordSupplierCandidate({ supplier: "max", keyword: "max", confidence: 0.95 }),
      buildUserCorrectedSupplierCandidate({ supplier: "max" }),
    ],
  });
  const gate = evaluateSupplierGate({ supplierDecision: decision });
  assert.equal(gate.verdict, "pass");
});

test("supplier gate snapshot is stored alongside amount gate", () => {
  const parsedFieldsJson: Record<string, unknown> = {};
  attachSupplierGateToParsedFields(parsedFieldsJson, {
    supplierDecision: baseSupplierDecision(),
  });
  const gates = parsedFieldsJson.gates as Array<{ gate: string }>;
  assert.equal(gates.length, 1);
  assert.equal(gates[0]?.gate, "supplier");
});
