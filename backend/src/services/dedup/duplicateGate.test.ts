import test from "node:test";
import assert from "node:assert/strict";

import {
  attachAmountGateToParsedFields,
} from "../amount/amountGate.js";
import { ARC_VERSION } from "../amount/canonicalAmount.js";
import {
  attachDuplicateGateToParsedFields,
  detectAmountRecoveredOnRescan,
  evaluateDuplicateGate,
} from "./duplicateGate.js";
import { attachFingerprintGateToParsedFields } from "./fingerprintGate.js";
import { computeCanonicalFingerprint } from "./sharedMatcher.js";
import { attachSupplierGateToParsedFields } from "../supplier/supplierGate.js";
import { SIR_VERSION } from "../supplier/supplierTypes.js";
import { supplierPaymentPersistenceDecision, buildPassingTrustGateSnapshots } from "../trust/trustGatePersistence.js";

const orgId = "org-duplicate-gate";

function basePassInput(overrides: Partial<Parameters<typeof evaluateDuplicateGate>[0]> = {}) {
  return {
    matchResult: "NO_MATCH" as const,
    matchReasons: ["no_candidate_match"],
    ...overrides,
  };
}

test("no existing match is duplicate PASS", () => {
  const gate = evaluateDuplicateGate(basePassInput());
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.reasonCode, "duplicate.none");
  assert.equal(gate.matchStrength, "none");
});

test("existing SCFC fingerprint match is BLOCK", () => {
  const gate = evaluateDuplicateGate(
    basePassInput({
      matchResult: "MATCH",
      matchReasons: ["fingerprint_match"],
      matchedCandidate: { id: "payment-1" },
    })
  );
  assert.equal(gate.verdict, "block");
  assert.equal(gate.reasonCode, "duplicate.confirmed_match");
  assert.equal(gate.matchedPaymentId, "payment-1");
});

test("same fileSha256 is BLOCK", () => {
  const gate = evaluateDuplicateGate(
    basePassInput({
      matchResult: "MATCH",
      matchReasons: ["same_file_sha256"],
      matchedCandidate: { id: "payment-file" },
    })
  );
  assert.equal(gate.verdict, "block");
  assert.equal(gate.reasonCode, "duplicate.file_hash_match");
});

test("same invoice number and amount is BLOCK", () => {
  const gate = evaluateDuplicateGate(
    basePassInput({
      matchResult: "MATCH",
      matchReasons: ["same_invoice_number_and_amount"],
      matchedCandidate: { id: "payment-inv" },
    })
  );
  assert.equal(gate.verdict, "block");
  assert.equal(gate.reasonCode, "duplicate.invoice_amount_match");
});

test("same supplier amount date without invoice number is REVIEW", () => {
  const gate = evaluateDuplicateGate(
    basePassInput({
      matchResult: "UNSURE",
      matchReasons: ["same_supplier", "same_amount", "same_date"],
      matchedCandidate: { id: "payment-borderline" },
      invoiceNumber: null,
    })
  );
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "duplicate.semantic_unsure");
  assert.equal(gate.matchStrength, "unsure");
});

test("legacy duplicate key mismatch is REVIEW", () => {
  const gate = evaluateDuplicateGate(
    basePassInput({
      legacyDuplicateKey: "legacy-key-a",
      scfcFingerprint: "scfc-v1:other",
    })
  );
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "duplicate.key_mismatch");
});

test("force reprocess is REVIEW", () => {
  const gate = evaluateDuplicateGate(basePassInput({ forceReprocess: true }));
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "duplicate.force_reprocess");
});

test("rescan changed amount is REVIEW", () => {
  const gate = evaluateDuplicateGate(
    basePassInput({
      identityStability: { amountChanged: true, fieldsChanged: true },
    })
  );
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "duplicate.rescan_identity_changed");
});

test("rescan recovered missing amount is REVIEW", () => {
  assert.equal(
    detectAmountRecoveredOnRescan({ existingScanItem: { amount: null }, currentAmount: 120 }),
    true
  );
  const gate = evaluateDuplicateGate(basePassInput({ amountRecoveredOnRescan: true }));
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "duplicate.rescan_amount_recovered");
});

test("cross-channel possible match is REVIEW", () => {
  const gate = evaluateDuplicateGate(
    basePassInput({
      matchResult: "UNSURE",
      matchReasons: ["same_supplier", "same_amount"],
      matchedCandidate: { id: "payment-wa", source: "whatsapp", lastSource: "whatsapp" },
      currentSource: "gmail",
      crossChannelUnsure: true,
    })
  );
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "duplicate.cross_channel_unsure");
});

test("amount supplier fingerprint pass but duplicate REVIEW blocks payment", () => {
  const gates = buildPassingTrustGateSnapshots({
    duplicateGate: {
      verdict: "review",
      reasonCode: "duplicate.semantic_unsure",
      matchStrength: "unsure",
      matchedPaymentId: "payment-1",
    },
  });
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    ...gates,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, "duplicate.semantic_unsure");
});

test("duplicate BLOCK creates no payment", () => {
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 120,
    needsReview: false,
    ...buildPassingTrustGateSnapshots({
      duplicateGate: {
        verdict: "block",
        reasonCode: "duplicate.confirmed_match",
        matchStrength: "confirmed",
        matchedPaymentId: "payment-1",
      },
    }),
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.equal(decision.blockReason, "duplicate.confirmed_match");
});

test("gate snapshots preserve amount supplier fingerprint and duplicate", () => {
  const parsedFieldsJson: Record<string, unknown> = {};
  attachAmountGateToParsedFields(parsedFieldsJson, {
    moneyDecision: {
      selectedAmount: 49,
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
  attachSupplierGateToParsedFields(parsedFieldsJson, {
    supplierDecision: {
      supplierName: "Netlify Inc.",
      canonicalSupplier: "netlify",
      normalizedName: "netlify inc",
      vatNumber: null,
      domains: [],
      emails: [],
      phones: [],
      aliases: [],
      logo: null,
      confidence: 0.9,
      evidenceScore: 0.9,
      reason: "document labeled",
      reasonCode: "DOCUMENT_LABELED",
      evidence: [],
      candidates: [],
      rejected: [],
      status: "resolved",
      ambiguityFlags: [],
      version: SIR_VERSION,
      isStrongEnoughForAutoSave: true,
    },
  });
  const scfc = computeCanonicalFingerprint({
    organizationId: orgId,
    supplierName: "Netlify Inc.",
    invoiceNumber: "NF-88991",
    totalAmount: 49,
    documentDate: "2026-06-01",
    documentType: "invoice",
  });
  attachFingerprintGateToParsedFields(parsedFieldsJson, {
    scfc,
    documentFingerprint: scfc.fingerprint,
  });
  attachDuplicateGateToParsedFields(parsedFieldsJson, basePassInput());
  const gates = parsedFieldsJson.gates as Array<{ gate: string }>;
  assert.equal(gates.length, 4);
  assert.deepEqual(gates.map((entry) => entry.gate).sort(), ["amount", "duplicate", "fingerprint", "supplier"]);
});

test("email attachment match is REVIEW", () => {
  const gate = evaluateDuplicateGate(basePassInput({ sameEmailAttachmentMatch: true }));
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "duplicate.email_attachment_match");
});
