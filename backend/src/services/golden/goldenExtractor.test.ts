import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildGoldenCaseFromRecord,
  buildGoldenStagingDocument,
  extractGoldenStagingCase,
  sanitizeGoldenCase,
  writeGoldenStagingCase,
} from "./goldenExtractor.js";
import type { GoldenSourceRecord } from "./goldenExtractor.js";
import {
  containsLikelyPii,
  maskAddresses,
  maskEmails,
  maskInvoiceNumbers,
  maskPhoneNumbers,
  maskTaxIds,
  minimizeRawOcrText,
  SANITIZED_ADDRESS,
  SANITIZED_EMAIL,
  SANITIZED_INVOICE,
  SANITIZED_NAME,
  SANITIZED_PHONE,
  SANITIZED_TAX_ID,
} from "./goldenSanitizer.js";

test("golden sanitizer: masks emails", () => {
  const result = maskEmails("Contact billing@acme.co.il or ADMIN@EXAMPLE.COM today");
  assert.equal(result, `Contact ${SANITIZED_EMAIL} or ${SANITIZED_EMAIL} today`);
});

test("golden sanitizer: masks phone numbers", () => {
  const result = maskPhoneNumbers("Call +972-50-123-4567 or 03-5551234");
  assert.ok(result.includes(SANITIZED_PHONE));
  assert.ok(!result.includes("1234567"));
});

test("golden sanitizer: masks addresses", () => {
  const result = maskAddresses("Ship to 12 Herzl Street Tel Aviv");
  assert.equal(result, `Ship to ${SANITIZED_ADDRESS} Tel Aviv`);
});

test("golden sanitizer: masks tax IDs", () => {
  const result = maskTaxIds("Company id 514888888 on invoice");
  assert.equal(result, `Company id ${SANITIZED_TAX_ID} on invoice`);
});

test("golden sanitizer: masks invoice numbers", () => {
  const result = maskInvoiceNumbers("Invoice INV-12345 and tax ref ABC-98765");
  assert.equal(result, `Invoice ${SANITIZED_INVOICE} and tax ref ${SANITIZED_INVOICE}`);
});

test("golden sanitizer: minimizes raw OCR text", () => {
  const ocr =
    "חשבונית מס עבור John Smith billing@corp.example.com phone 0501234567 tax 514888888 INV-7788 " +
    "extra noisy text that should be truncated because OCR dumps are often very long and sensitive";
  const minimized = minimizeRawOcrText(ocr);

  assert.ok(minimized);
  assert.ok(minimized!.length <= 80);
  assert.ok(!containsLikelyPii(minimized!));
  assert.match(minimized!, /\[EMAIL\]|\[PHONE\]|\[TAX_ID\]|INV-\*\*\*\*/);
});

test("golden extractor: maps GmailScanItem record to golden case expected values", () => {
  const record: GoldenSourceRecord = {
    id: "gsi_test_001",
    sourceTable: "GmailScanItem",
    organizationId: "org-real-should-not-appear",
    documentType: "invoice",
    supplierName: "Acme Ltd",
    amount: 1180,
    currency: "ILS",
    reviewStatus: "auto_saved",
    decisionReason: "auto_saved strong match",
    createdAt: "2026-06-01T10:00:00.000Z",
    parsedFieldsJson: {
      amount: 1180,
      invoiceNumber: "INV-9001",
      invoiceDate: "2026-05-15",
      arc: {
        selectedAmount: 1180,
        currency: "ILS",
        status: "resolved",
        reasonCode: "INVOICE_TOTAL",
        candidates: [
          {
            value: 1180,
            kind: "invoice_total",
            source: "claude_file",
            label: "total",
            confidence: 0.95,
          },
        ],
      },
      sir: {
        supplierName: "Acme Ltd",
        canonicalSupplier: "Acme",
        vatNumber: "514888888",
        status: "resolved",
        reasonCode: "VAT_REGISTRY_MATCH",
      },
      fse: {
        overallStatus: "valid",
        explanation: "All sanity checks passed",
      },
      trust: {
        decision: "AUTO_SAVE",
        reasonCode: "TE_STRONG_AGREEMENT",
      },
      outcome: {
        status: "SAVED",
        reason: "Document ready for automatic save",
        reasonCode: "OE_AUTO_SAVE",
      },
    },
  };

  const built = buildGoldenCaseFromRecord(record);
  assert.equal(built.documentType, "tax_invoice");
  assert.equal(built.channel, "gmail");
  assert.equal(built.expected.outcomeStatus, "SAVED");
  assert.equal(built.expected.shouldAutoSave, true);
  assert.equal(built.expected.shouldReject, false);
  assert.equal(built.expected.supplierName, "Acme");
  assert.equal(built.expected.amount, 1180);
  assert.equal(built.input.amountCandidates.length, 1);
  assert.equal(built.input.fingerprint.organizationId, "org-golden-staging");
});

test("golden extractor: sanitizeGoldenCase removes obvious PII from output", () => {
  const record: GoldenSourceRecord = {
    id: "fdr_test_002",
    sourceTable: "FinancialDocumentReview",
    documentType: "tax_invoice",
    supplierName: "billing@supplier.example.com",
    amount: 990,
    reviewStatus: "needs_review",
    decisionReason: "supplier unresolved; call 050-9876543 at 22 Rothschild Boulevard",
    parsedFieldsJson: {
      invoiceNumber: "INV-445566",
      arc: { selectedAmount: 990, status: "ambiguous", reasonCode: "AMOUNT_CONFLICT" },
      sir: { supplierName: "billing@supplier.example.com", status: "unresolved" },
      trust: { decision: "NEEDS_REVIEW", reasonCode: "TE_SUPPLIER_UNCERTAIN" },
      outcome: { status: "NEEDS_REVIEW", reason: "Manual review required" },
    },
    rawOcrText:
      "Invoice for Mr. John Smith billing@supplier.example.com VAT 514888888 INV-445566 22 Herzl Street",
  };

  const sanitized = sanitizeGoldenCase(buildGoldenCaseFromRecord(record));
  const serialized = JSON.stringify(sanitized);

  assert.equal(sanitized.input.invoiceNumber, SANITIZED_INVOICE);
  assert.equal(sanitized.input.fingerprint.invoiceNumber, SANITIZED_INVOICE);
  assert.equal(sanitized.input.supplierCandidates[0]?.vatNumber, null);
  assert.ok(sanitized.input.rawOcrText == null || !containsLikelyPii(sanitized.input.rawOcrText));
  assert.ok(!serialized.includes("billing@supplier.example.com"));
  assert.ok(!serialized.includes("514888888"));
  assert.ok(!serialized.includes("INV-445566"));
  assert.ok(!serialized.includes("050-9876543"));
  assert.ok(!serialized.includes("John Smith") || serialized.includes(SANITIZED_NAME));
});

test("golden extractor: writeGoldenStagingCase writes gitignored staging json", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "golden-staging-"));
  try {
    const record: GoldenSourceRecord = {
      id: "sp_test_003",
      sourceTable: "SupplierPayment",
      documentType: "tax_invoice",
      supplierName: "Beta Supplies",
      amount: 250,
      source: "gmail",
      reviewStatus: "auto_saved",
      parsedFieldsJson: {
        arc: { selectedAmount: 250, currency: "ILS", status: "resolved" },
        sir: { canonicalSupplier: "Beta", status: "resolved" },
        outcome: { status: "SAVED", reason: "saved" },
        trust: { decision: "AUTO_SAVE" },
      },
    };

    const { filePath, document } = extractGoldenStagingCase(record, tempDir);
    const written = readFileSync(filePath, "utf8");

    assert.equal(document.case.id, "gd-staging-supplierpayment-sp_test_003");
    assert.ok(written.includes('"version": "golden-v1"'));
    assert.ok(!containsLikelyPii(JSON.stringify(document.case)));
    assert.equal(document.source.sourceTable, "SupplierPayment");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("golden extractor: buildGoldenStagingDocument never includes source organization id", () => {
  const record: GoldenSourceRecord = {
    id: "gsi_org_leak",
    sourceTable: "GmailScanItem",
    organizationId: "cmpSECRETORGID0001",
    documentType: "receipt",
    supplierName: "Cafe",
    amount: 45,
    parsedFieldsJson: {
      outcome: { status: "SAVED" },
      trust: { decision: "AUTO_SAVE" },
    },
  };

  const document = buildGoldenStagingDocument(record);
  const serialized = JSON.stringify(document);

  assert.ok(!serialized.includes("cmpSECRETORGID0001"));
  assert.equal(document.case.input.organizationId, "org-golden-staging");
});
