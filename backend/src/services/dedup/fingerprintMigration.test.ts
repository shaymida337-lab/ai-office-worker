import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCanonicalFingerprint,
  buildFinancialDocumentFingerprint,
  SCFC_VERSION,
} from "./sharedMatcher.js";
import {
  buildClientGmailPaymentLookupClauses,
  buildLegacyDuplicateHashForLookup,
  buildPaymentLookupsFromCanonical,
  buildSupplierPaymentLookupClauses,
  resolvePaymentStorageFingerprints,
} from "./fingerprintMigration.js";

const goldenInvoice = {
  organizationId: "org-golden-1",
  supplierName: "Netlify Inc.",
  supplierTaxId: "123456789",
  invoiceNumber: "NF-88991",
  totalAmount: 49,
  documentDate: "2026-06-01",
  documentType: "tax_invoice",
  fileSha256: "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890",
};

test("computeCanonicalFingerprint uses scfc-v1 prefix and differs from legacy semantic fingerprint", () => {
  const result = computeCanonicalFingerprint(goldenInvoice);
  assert.equal(result.version, SCFC_VERSION);
  assert.equal(result.tier, "file");
  assert.ok(result.fingerprint);
  assert.notEqual(result.fingerprint, result.legacyFingerprint);
  assert.equal(result.isStrongEnoughForAutoSaveDedup, true);
});

test("cross-channel parity: same document fields produce identical canonical fingerprint", () => {
  const gmailInput = { ...goldenInvoice, fileSha256: null, documentType: "invoice" };
  const whatsappInput = {
    ...goldenInvoice,
    supplierName: "netlify",
    invoiceNumber: "Invoice NF 88991",
    totalAmount: "49.00 ILS",
    documentDate: "2026-06-02",
    documentType: "tax_invoice",
    fileSha256: null,
  };
  const cameraInput = {
    ...goldenInvoice,
    supplierName: "NETLIFY INC",
    invoiceNumber: "nf 88991",
    documentType: "receipt",
    fileSha256: null,
  };

  const gmailFp = computeCanonicalFingerprint(gmailInput).fingerprint;
  const whatsappFp = computeCanonicalFingerprint(whatsappInput).fingerprint;
  const cameraFp = computeCanonicalFingerprint(cameraInput).fingerprint;

  assert.equal(gmailFp, whatsappFp);
  assert.equal(whatsappFp, cameraFp);
});

test("same file bytes produce identical canonical fingerprint across channels", () => {
  const gmail = computeCanonicalFingerprint({ organizationId: "org-1", fileSha256: "deadbeef" }).fingerprint;
  const whatsapp = computeCanonicalFingerprint({ organizationId: "org-1", fileSha256: "DEADBEEF" }).fingerprint;
  assert.equal(gmail, whatsapp);
});

test("legacy compatibility: dual-read clauses include canonical, legacy semantic, and legacy duplicate hash", () => {
  const canonical = computeCanonicalFingerprint(goldenInvoice);
  const legacyDuplicateHash = buildLegacyDuplicateHashForLookup({
    organizationId: goldenInvoice.organizationId,
    supplier: goldenInvoice.supplierName,
    amount: goldenInvoice.totalAmount,
    dateIso: "2026-06-01",
    subject: "invoice subject",
  });
  const clauses = buildSupplierPaymentLookupClauses({
    canonicalFingerprint: canonical.fingerprint!,
    legacySemanticFingerprint: canonical.legacyFingerprint,
    legacyDuplicateHash,
    legacyGmailScanDuplicateKey: "legacy-gmail-scan-key",
    supplierName: goldenInvoice.supplierName,
    invoiceNumber: goldenInvoice.invoiceNumber,
    totalAmount: goldenInvoice.totalAmount,
    documentDate: new Date("2026-06-01"),
  });

  assert.ok(clauses.some((clause) => JSON.stringify(clause).includes(canonical.fingerprint!)));
  assert.ok(clauses.some((clause) => JSON.stringify(clause).includes(canonical.legacyFingerprint)));
  assert.ok(clauses.some((clause) => JSON.stringify(clause).includes(legacyDuplicateHash)));
  assert.ok(clauses.some((clause) => JSON.stringify(clause).includes("legacy-gmail-scan-key")));
});

test("dual-write aliases duplicateHash to canonical fingerprint", () => {
  const canonical = computeCanonicalFingerprint(goldenInvoice);
  const stored = resolvePaymentStorageFingerprints({ canonical });
  assert.equal(stored.documentFingerprint, stored.duplicateHash);
  assert.equal(stored.documentFingerprint, canonical.fingerprint);
});

test("buildPaymentLookupsFromCanonical returns SCFC duplicateHash for gmail ingest", () => {
  const canonical = computeCanonicalFingerprint({
    organizationId: "org-1",
    supplierName: "OpenAI",
    invoiceNumber: "INV-1001",
    totalAmount: 120,
    documentDate: "2026-06-01",
    documentType: "invoice",
  });
  const lookups = buildPaymentLookupsFromCanonical({
    organizationId: "org-1",
    canonicalFingerprint: canonical.fingerprint!,
    supplierName: "OpenAI",
    invoiceNumber: "INV-1001",
    totalAmount: 120,
    documentDate: new Date("2026-06-01"),
    documentType: "invoice",
    subject: "invoice email",
    legacyGmailScanDuplicateKey: "legacy-scan-key",
  });
  assert.equal(lookups.duplicateHash, canonical.fingerprint);
  assert.ok(lookups.lookupClauses.length >= 3);
});

test("legacy buildFinancialDocumentFingerprint remains stable for existing records", () => {
  const legacy = buildFinancialDocumentFingerprint(goldenInvoice);
  assert.equal(legacy, computeCanonicalFingerprint(goldenInvoice).legacyFingerprint);
});

test("client gmail lookup clauses include canonical and legacy duplicate hash", () => {
  const canonical = computeCanonicalFingerprint({
    organizationId: "org-1",
    supplierName: "Acme",
    invoiceNumber: "A-1",
    totalAmount: 10,
    documentDate: "2026-06-01",
  });
  const legacyDuplicateHash = buildLegacyDuplicateHashForLookup({
    organizationId: "org-1",
    supplier: "Acme",
    amount: 10,
    dateIso: "2026-06-01",
    subject: "subject",
  });
  const clauses = buildClientGmailPaymentLookupClauses({
    canonicalFingerprint: canonical.fingerprint!,
    legacyDuplicateHash,
    supplier: "Acme",
    invoiceNumber: "A-1",
    amount: 10,
    date: new Date("2026-06-01"),
  });
  assert.ok(clauses.some((clause) => "duplicateHash" in clause));
  assert.ok(clauses.some((clause) => "documentFingerprint" in clause));
});

test("computeCanonicalFingerprint requires organizationId", () => {
  assert.throws(() => computeCanonicalFingerprint({ supplierName: "Acme" }), /organizationId/);
});
