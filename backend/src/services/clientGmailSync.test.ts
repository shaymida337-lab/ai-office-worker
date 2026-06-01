import test from "node:test";
import assert from "node:assert/strict";
import { decideClientGmailFinancialDocumentDuplicate } from "./clientGmailSync.js";

test("client Gmail dedup marks known duplicate as MATCH", () => {
  const result = decideClientGmailFinancialDocumentDuplicate({
    current: {
      organizationId: "org-1",
      supplierName: "OpenAI LLC",
      invoiceNumber: "INV-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    legacyDuplicateHash: "legacy-current",
    candidates: [
      {
        id: "payment-1",
        supplier: "openai",
        invoiceNumber: "Invoice INV-1001",
        amount: 120,
        date: new Date("2026-06-02T10:00:00.000Z"),
        documentTypeDetailed: "tax_invoice",
        duplicateHash: "different-legacy",
      },
    ],
  });

  assert.equal(result.result, "MATCH");
  assert.equal(result.candidate?.id, "payment-1");
  assert.match(result.reasons.join(","), /same_invoice_number_and_amount|fingerprint_match/);
});

test("client Gmail dedup lets new item proceed as NO_MATCH", () => {
  const result = decideClientGmailFinancialDocumentDuplicate({
    current: {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    legacyDuplicateHash: "legacy-current",
    candidates: [
      {
        id: "payment-2",
        supplier: "Netlify",
        invoiceNumber: "NF-2002",
        amount: 49,
        date: new Date("2026-06-05T10:00:00.000Z"),
        documentTypeDetailed: "invoice",
        duplicateHash: "different-legacy",
      },
    ],
  });

  assert.equal(result.result, "NO_MATCH");
  assert.equal(result.candidate, null);
});

test("client Gmail dedup sends borderline duplicate to review as UNSURE", () => {
  const result = decideClientGmailFinancialDocumentDuplicate({
    current: {
      organizationId: "org-1",
      supplierName: "Hardware Store Ltd",
      totalAmount: 350,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    legacyDuplicateHash: "legacy-current",
    candidates: [
      {
        id: "payment-3",
        supplier: "hardware store",
        amount: 350,
        date: new Date("2026-06-01T12:00:00.000Z"),
        documentTypeDetailed: "invoice",
        duplicateHash: "different-legacy",
      },
    ],
  });

  assert.equal(result.result, "UNSURE");
  assert.equal(result.candidate?.id, "payment-3");
  assert.match(result.reasons.join(","), /same_supplier/);
});

test("client Gmail dedup keeps legacy duplicateHash fallback for old records", () => {
  const result = decideClientGmailFinancialDocumentDuplicate({
    current: {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    legacyDuplicateHash: "legacy-current",
    candidates: [
      {
        id: "payment-4",
        supplier: "Different Supplier",
        invoiceNumber: "OLD-9",
        amount: 999,
        date: new Date("2026-01-01T10:00:00.000Z"),
        documentTypeDetailed: "invoice",
        duplicateHash: "legacy-current",
      },
    ],
  });

  assert.equal(result.result, "MATCH");
  assert.equal(result.candidate?.id, "payment-4");
  assert.deepEqual(result.reasons, ["legacy_duplicate_hash"]);
});
