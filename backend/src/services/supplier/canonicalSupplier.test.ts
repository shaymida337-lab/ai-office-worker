import test from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalSupplier } from "./canonicalSupplier.js";
import {
  buildDocumentLabelSupplierCandidate,
  buildHistoricalSupplierCandidate,
  buildOcrKeywordSupplierCandidate,
  buildSenderSupplierCandidates,
  buildUserCorrectedSupplierCandidate,
} from "./supplierCandidates.js";
import type { SupplierCandidate } from "./supplierTypes.js";

function decide(candidates: SupplierCandidate[], organizationId = "org-sir") {
  return computeCanonicalSupplier({
    organizationId,
    channel: "test",
    candidates,
  });
}

test("SIR VAT registry wins over conflicting AI supplier name", () => {
  const result = decide([
    { name: "Wrong Supplier Ltd", kind: "ai_extracted", source: "claude_email", confidence: 0.85 },
    {
      name: "חברת החשמל",
      kind: "vat_registry",
      source: "registry",
      vatNumber: "520000391",
      confidence: 0.95,
    },
  ]);

  assert.equal(result.status, "resolved");
  assert.equal(result.supplierName, "חברת החשמל");
  assert.equal(result.canonicalSupplier, "iec");
  assert.equal(result.vatNumber, "520000391");
  assert.equal(result.reasonCode, "VAT_REGISTRY");
  assert.ok(result.confidence >= 0.9);
  assert.equal(result.version, "sir-v1");
});

test("SIR user correction wins over all other evidence", () => {
  const result = decide([
    buildUserCorrectedSupplierCandidate({ supplier: "חברת החשמל", vatNumber: "520000391" }),
    { name: "Israel Electric Corporation", kind: "ai_extracted", source: "claude_file", confidence: 0.99 },
    buildOcrKeywordSupplierCandidate({ supplier: "Wolt", keyword: "wolt" }),
  ]);

  assert.equal(result.status, "resolved");
  assert.equal(result.supplierName, "חברת החשמל");
  assert.equal(result.reasonCode, "USER_CORRECTED");
  assert.equal(result.isStrongEnoughForAutoSave, true);
});

test("SIR OCR keyword plus historical invoices resolves canonical supplier", () => {
  const result = decide([
    buildOcrKeywordSupplierCandidate({ supplier: "חברת החשמל", keyword: "חברת החשמל", confidence: 0.99 }),
    buildHistoricalSupplierCandidate({ supplier: "חברת החשמל לישראל", priorInvoiceCount: 24 }),
  ]);

  assert.equal(result.status, "resolved");
  assert.equal(result.supplierName, "חברת החשמל");
  assert.equal(result.canonicalSupplier, "iec");
  assert.ok(result.evidence.length >= 2);
  assert.equal(result.isStrongEnoughForAutoSave, true);
});

test("SIR does not resolve supplier from email domain alone", () => {
  const result = decide(buildSenderSupplierCandidates({
    senderDomain: "iec.co.il",
    senderDisplayName: null,
  }).filter((candidate) => candidate.kind === "email_domain"));

  assert.equal(result.status, "missing");
  assert.equal(result.supplierName, null);
  assert.equal(result.reasonCode, "MISSING");
  assert.equal(result.isStrongEnoughForAutoSave, false);
});

test("SIR rejects phone numbers as supplier", () => {
  const result = decide([
    { name: "0501234567", kind: "phone", source: "sender", confidence: 0.9 },
  ]);

  assert.equal(result.status, "missing");
  assert.equal(result.supplierName, null);
  assert.ok(result.rejected.some((candidate) => candidate.reason === "phone_not_supplier"));
});

test("SIR rejects address lines as supplier", () => {
  const result = decide([
    {
      name: "תל אביב, רחוב הרצל 12",
      kind: "address",
      source: "claude_email",
      confidence: 0.9,
    },
  ]);

  assert.equal(result.status, "missing");
  assert.equal(result.supplierName, null);
  assert.ok(result.rejected.some((candidate) => candidate.reason === "address_not_supplier"));
});

test("SIR rejects dot current and unknown placeholders", () => {
  for (const name of [".", "Current", "Unknown supplier", "לא ידוע"]) {
    const result = decide([{ name, kind: "ai_extracted", source: "claude_email", confidence: 0.8 }]);
    assert.equal(result.status, "missing", `expected missing for ${name}`);
    assert.equal(result.supplierName, null);
    assert.ok(result.rejected.length > 0, `expected rejection for ${name}`);
  }
});

test("SIR normalizes Hebrew and English aliases to one canonical supplier", () => {
  const hebrew = decide([{ name: "וולט", kind: "ai_extracted", source: "claude_file", confidence: 0.82 }]);
  const english = decide([{ name: "Wolt Technologies", kind: "ai_extracted", source: "claude_file", confidence: 0.82 }]);

  assert.equal(hebrew.status, "resolved");
  assert.equal(english.status, "resolved");
  assert.equal(hebrew.canonicalSupplier, "wolt");
  assert.equal(english.canonicalSupplier, "wolt");
  assert.equal(hebrew.supplierName, "Wolt");
  assert.equal(english.supplierName, "Wolt");
  assert.ok(hebrew.aliases.includes("וולט"));
});

test("SIR flags ambiguous when two strong suppliers diverge", () => {
  const result = decide([
    buildDocumentLabelSupplierCandidate({ supplier: "OpenAI LLC", confidence: 0.95 }),
    buildDocumentLabelSupplierCandidate({ supplier: "Netlify Inc", confidence: 0.94 }),
  ]);

  assert.equal(result.status, "ambiguous");
  assert.equal(result.supplierName, null);
  assert.equal(result.reasonCode, "AMBIGUOUS");
  assert.ok(result.ambiguityFlags.includes("multiple_entities"));
});

test("SIR is deterministic for the same candidate set", () => {
  const candidates = [
    buildDocumentLabelSupplierCandidate({ supplier: "חברת החשמל", vatNumber: "520000391", confidence: 0.95 }),
    buildOcrKeywordSupplierCandidate({ supplier: "חברת החשמל", keyword: "חברת החשמל", confidence: 0.99 }),
  ];
  const first = decide(candidates);
  const second = decide(candidates);

  assert.deepEqual(
    {
      supplierName: first.supplierName,
      canonicalSupplier: first.canonicalSupplier,
      normalizedName: first.normalizedName,
      vatNumber: first.vatNumber,
      status: first.status,
      reasonCode: first.reasonCode,
      confidence: first.confidence,
    },
    {
      supplierName: second.supplierName,
      canonicalSupplier: second.canonicalSupplier,
      normalizedName: second.normalizedName,
      vatNumber: second.vatNumber,
      status: second.status,
      reasonCode: second.reasonCode,
      confidence: second.confidence,
    }
  );
});

test("SIR document label with VAT resolves through registry", () => {
  const result = decide([
    buildDocumentLabelSupplierCandidate({
      supplier: "Israel Electric Corporation",
      vatNumber: "520000391",
      confidence: 0.93,
    }),
  ]);

  assert.equal(result.status, "resolved");
  assert.equal(result.supplierName, "חברת החשמל");
  assert.equal(result.canonicalSupplier, "iec");
});

test("SIR registry seed supports historical confidence fields on DNA types", () => {
  const result = decide([
    buildHistoricalSupplierCandidate({ supplier: "OpenAI LLC", priorInvoiceCount: 8 }),
  ]);

  assert.equal(result.status, "resolved");
  assert.equal(result.canonicalSupplier, "openai");
  assert.ok(result.confidence >= 0.75);
});
