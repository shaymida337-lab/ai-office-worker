import assert from "node:assert/strict";
import test from "node:test";
import {
  hasVendorAndAmountForAutoApprove,
  resolveGmailMessageReceivedAt,
  resolveInvoiceDocumentDate,
} from "./invoiceDocumentDate.js";

test("resolveGmailMessageReceivedAt prefers Date header then internalDate; never invents now", () => {
  const fromHeader = resolveGmailMessageReceivedAt({
    dateHeader: "Mon, 01 Jun 2026 10:00:00 +0000",
    internalDate: "1710000000000",
  });
  assert.equal(fromHeader?.toISOString().slice(0, 10), "2026-06-01");

  const fromInternal = resolveGmailMessageReceivedAt({
    dateHeader: "not-a-date",
    internalDate: String(Date.UTC(2025, 11, 15)),
  });
  assert.equal(fromInternal?.toISOString().slice(0, 10), "2025-12-15");

  assert.equal(resolveGmailMessageReceivedAt({ dateHeader: null, internalDate: null }), null);
});

test("resolveInvoiceDocumentDate uses OCR date then email sent; never today", () => {
  const email = new Date("2026-03-10T12:00:00.000Z");
  const fromDoc = resolveInvoiceDocumentDate({
    analysisInvoiceDate: "2026-02-01",
    emailReceivedAt: email,
  });
  assert.equal(fromDoc.source, "document");
  assert.equal(fromDoc.date?.toISOString().slice(0, 10), "2026-02-01");

  const fromEmail = resolveInvoiceDocumentDate({
    analysisInvoiceDate: null,
    extractedInvoiceDate: null,
    emailReceivedAt: email,
  });
  assert.equal(fromEmail.source, "email_sent");
  assert.equal(fromEmail.date?.toISOString().slice(0, 10), "2026-03-10");

  const missing = resolveInvoiceDocumentDate({
    analysisInvoiceDate: null,
    emailReceivedAt: null,
  });
  assert.equal(missing.date, null);
  assert.equal(missing.source, null);
});

test("hasVendorAndAmountForAutoApprove requires usable supplier and positive amount", () => {
  assert.equal(
    hasVendorAndAmountForAutoApprove({
      supplierName: "בזק",
      amount: 100,
      isUsableSupplier: () => true,
    }),
    true
  );
  assert.equal(
    hasVendorAndAmountForAutoApprove({
      supplierName: "לא זוהה",
      amount: 100,
      isUsableSupplier: () => false,
    }),
    false
  );
  assert.equal(
    hasVendorAndAmountForAutoApprove({
      supplierName: "בזק",
      amount: null,
      isUsableSupplier: () => true,
    }),
    false
  );
});
