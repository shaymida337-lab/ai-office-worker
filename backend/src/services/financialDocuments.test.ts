import test from "node:test";
import assert from "node:assert/strict";
import { financialDocumentBlockingReason, matchExistingFinancialDocumentCandidate } from "./financialDocuments.js";

test("financial document gate routes amounts at or over 1M to needs_review", () => {
  for (const totalAmount of [1_000_000, 2_000_000]) {
    const reason = financialDocumentBlockingReason({
      supplierName: "OpenAI LLC",
      invoiceNumber: "INV-2026-1001",
      totalAmount,
      documentDate: "2026-06-01",
    });

    assert.match(reason ?? "", /exceeds review threshold/, `expected review for amount ${totalAmount}`);
  }
});

test("financial document gate accepts otherwise-valid amounts under 1M", () => {
  const reason = financialDocumentBlockingReason({
    supplierName: "OpenAI LLC",
    invoiceNumber: "INV-2026-1001",
    totalAmount: 500_000,
    documentDate: "2026-06-01",
  });

  assert.equal(reason, null);
});

test("financial document matcher marks known duplicate as MATCH", () => {
  const result = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: "org-1",
      supplierName: "OpenAI LLC",
      invoiceNumber: "INV-2026-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    candidates: [
      {
        id: "payment-1",
        supplier: "openai",
        invoiceNumber: "Invoice INV 2026-1001",
        amount: 120,
        date: new Date("2026-06-02T10:00:00.000Z"),
        documentTypeDetailed: "tax_invoice",
      },
    ],
  });

  assert.equal(result.result, "MATCH");
  assert.equal(result.candidate?.id, "payment-1");
});

test("financial document matcher lets new document proceed as NO_MATCH", () => {
  const result = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-2026-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    candidates: [
      {
        id: "payment-2",
        supplier: "Netlify",
        invoiceNumber: "NF-2002",
        amount: 49,
        date: new Date("2026-06-05T10:00:00.000Z"),
        documentTypeDetailed: "invoice",
      },
    ],
  });

  assert.equal(result.result, "NO_MATCH");
  assert.equal(result.candidate, null);
});

test("financial document matcher sends borderline candidate to review as UNSURE", () => {
  const result = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: "org-1",
      supplierName: "Hardware Store Ltd",
      totalAmount: 350,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    candidates: [
      {
        id: "payment-3",
        supplier: "hardware store",
        amount: 350,
        date: new Date("2026-06-01T12:00:00.000Z"),
        documentTypeDetailed: "invoice",
      },
    ],
  });

  assert.equal(result.result, "UNSURE");
  assert.equal(result.candidate?.id, "payment-3");
  assert.match(result.reasons.join(","), /same_supplier/);
});
