import test from "node:test";
import assert from "node:assert/strict";

import { computeCanonicalFingerprint } from "./sharedMatcher.js";
import {
  attachAmountGateToParsedFields,
} from "../amount/amountGate.js";
import { ARC_VERSION } from "../amount/canonicalAmount.js";
import {
  attachFingerprintGateToParsedFields,
  detectScanIdentityInstability,
  evaluateFingerprintGate,
  summarizeScfcResult,
} from "./fingerprintGate.js";
import { attachSupplierGateToParsedFields } from "../supplier/supplierGate.js";
import { SIR_VERSION } from "../supplier/supplierTypes.js";
import { supplierPaymentPersistenceDecision, buildPassingTrustGateSnapshots } from "../trust/trustGatePersistence.js";

const orgId = "org-fingerprint-gate";

function goldenInvoice(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: orgId,
    supplierName: "Netlify Inc.",
    supplierTaxId: "123456789",
    invoiceNumber: "NF-88991",
    totalAmount: 49,
    documentDate: "2026-06-01",
    documentType: "tax_invoice",
    fileSha256: "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890",
    ...overrides,
  };
}

test("null fingerprint tier none is REVIEW", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: orgId,
    supplierName: null,
    invoiceNumber: null,
    totalAmount: null,
    documentDate: null,
  });
  const gate = evaluateFingerprintGate({ scfc, documentFingerprint: scfc.fingerprint });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.none_tier");
});

test("empty fingerprint string is REVIEW", () => {
  const scfc = computeCanonicalFingerprint(goldenInvoice());
  const gate = evaluateFingerprintGate({ scfc, documentFingerprint: "   " });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.empty");
});

test("weak tier is REVIEW", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: orgId,
    supplierName: "X",
    totalAmount: 10,
  });
  assert.equal(scfc.tier, "weak");
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.weak_tier");
});

test("legacy-only stored fingerprint is REVIEW", () => {
  const scfc = computeCanonicalFingerprint(goldenInvoice({ fileSha256: null }));
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.legacyFingerprint,
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.legacy_only");
});

test("missing tier fields is REVIEW", () => {
  const scfc = computeCanonicalFingerprint(goldenInvoice());
  scfc.normalizedInputs.fileSha256 = "";
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.missing_tier_fields");
});

test("forceReprocess is REVIEW", () => {
  const scfc = computeCanonicalFingerprint(goldenInvoice());
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
    forceReprocess: true,
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.force_reprocess");
});

test("identity changed on rescan is REVIEW", () => {
  const scfc = computeCanonicalFingerprint(goldenInvoice());
  const stability = detectScanIdentityInstability({
    existingScanItem: { amount: 120, supplierName: "Netlify Inc.", occurredAt: new Date("2026-06-01") },
    current: { amount: 49, supplierName: "Netlify Inc.", documentDate: new Date("2026-06-01") },
  });
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
    identityStability: stability,
  });
  assert.equal(gate.verdict, "review");
  assert.equal(gate.reasonCode, "fingerprint.identity_changed");
});

test("valid file tier with fileSha256 passes", () => {
  const scfc = computeCanonicalFingerprint(goldenInvoice());
  assert.equal(scfc.tier, "file");
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
    fileSha256: goldenInvoice().fileSha256,
  });
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.reasonCode, "fingerprint.resolved");
});

test("valid invoice-amount tier passes", () => {
  const scfc = computeCanonicalFingerprint(
    goldenInvoice({
      fileSha256: null,
      documentType: "invoice",
    })
  );
  assert.equal(scfc.tier, "invoice-amount");
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
  });
  assert.equal(gate.verdict, "pass");
});

test("valid supplier-amount-date tier passes", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: orgId,
    supplierName: "Acme Supplies",
    totalAmount: 250,
    documentDate: "2026-06-15",
    documentType: "receipt",
  });
  assert.equal(scfc.tier, "supplier-amount-date");
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
  });
  assert.equal(gate.verdict, "pass");
});

test("amount and supplier pass but fingerprint REVIEW blocks payment", () => {
  const amountGate = attachAmountGateToParsedFields({}, {
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
  const supplierGate = attachSupplierGateToParsedFields({}, {
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
      candidates: [{ name: "Netlify Inc.", kind: "document_labeled", source: "claude_file", tier: 90, score: 900, normalizedName: "netlify inc" }],
      rejected: [],
      status: "resolved",
      ambiguityFlags: [],
      version: SIR_VERSION,
      isStrongEnoughForAutoSave: true,
    },
  });
  const scfc = computeCanonicalFingerprint({ organizationId: orgId, supplierName: "X", totalAmount: 10 });
  const fingerprintGate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
  });
  const decision = supplierPaymentPersistenceDecision({
    selectedAmount: 49,
    needsReview: false,
    amountGate,
    supplierGate,
    fingerprintGate,
    duplicateGate: buildPassingTrustGateSnapshots().duplicateGate,
  });
  assert.equal(decision.shouldCreatePayment, false);
  assert.match(decision.blockReason ?? "", /^fingerprint\./);
});

test("gate snapshots preserve amount supplier and fingerprint", () => {
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
      candidates: [{ name: "Netlify Inc.", kind: "document_labeled", source: "claude_file", tier: 90, score: 900, normalizedName: "netlify inc" }],
      rejected: [],
      status: "resolved",
      ambiguityFlags: [],
      version: SIR_VERSION,
      isStrongEnoughForAutoSave: true,
    },
  });
  const scfc = computeCanonicalFingerprint(goldenInvoice());
  parsedFieldsJson.scfc = summarizeScfcResult(scfc);
  attachFingerprintGateToParsedFields(parsedFieldsJson, {
    scfc,
    documentFingerprint: scfc.fingerprint,
    fileSha256: goldenInvoice().fileSha256,
  });
  const gates = parsedFieldsJson.gates as Array<{ gate: string }>;
  assert.equal(gates.length, 3);
  assert.deepEqual(gates.map((entry) => entry.gate).sort(), ["amount", "fingerprint", "supplier"]);
});

test("existing valid Gmail invoice fingerprint still passes", () => {
  const scfc = computeCanonicalFingerprint({
    organizationId: orgId,
    supplierName: "OpenAI",
    invoiceNumber: "INV-1001",
    totalAmount: 65,
    documentDate: "2026-06-01",
    documentType: "invoice",
  });
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
  });
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.tier, "invoice-amount");
});

test("confirmed duplicate is BLOCK", () => {
  const scfc = computeCanonicalFingerprint(goldenInvoice());
  const gate = evaluateFingerprintGate({
    scfc,
    documentFingerprint: scfc.fingerprint,
    confirmedDuplicate: true,
  });
  assert.equal(gate.verdict, "block");
  assert.equal(gate.reasonCode, "fingerprint.confirmed_duplicate");
});
