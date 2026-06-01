import test from "node:test";
import assert from "node:assert/strict";
import { decideSupplierPaymentInvoiceBackfill } from "./invoiceBackfill.js";

test("invoice backfill does not turn supplier payment into customer Invoice", () => {
  const result = decideSupplierPaymentInvoiceBackfill({
    payment: {
      id: "payment-1",
      clientId: "client-1",
      supplier: "OpenAI",
      invoiceNumber: "INV-1001",
      amount: 120,
      date: new Date("2026-06-01T10:00:00.000Z"),
      documentTypeDetailed: "invoice",
      source: "gmail",
      subject: "Supplier invoice INV-1001",
    },
    invoiceCandidates: [],
  });

  assert.equal(result.action, "skip");
  assert.deepEqual(result.reasons, ["supplier_payment_not_customer_facing"]);
});

test("invoice backfill allows clearly customer-facing document", () => {
  const result = decideSupplierPaymentInvoiceBackfill({
    payment: {
      id: "payment-2",
      clientId: "client-1",
      supplier: "Acme Customer",
      invoiceNumber: "INV-2001",
      amount: 1200,
      date: new Date("2026-06-01T10:00:00.000Z"),
      documentTypeDetailed: "invoice",
      source: "customer_invoice",
      subject: "Customer invoice INV-2001",
    },
    invoiceCandidates: [],
  });

  assert.equal(result.action, "backfill");
});

test("invoice backfill routes borderline customer-facing match to review", () => {
  const result = decideSupplierPaymentInvoiceBackfill({
    payment: {
      id: "payment-3",
      clientId: "client-1",
      supplier: "Acme Customer",
      amount: 1200,
      date: new Date("2026-06-01T10:00:00.000Z"),
      documentTypeDetailed: "invoice",
      source: "customer_invoice",
      subject: "Customer invoice without number",
    },
    invoiceCandidates: [
      {
        id: "invoice-1",
        supplierName: "acme customer",
        amount: 1200,
        date: new Date("2026-06-01T12:00:00.000Z"),
      },
    ],
  });

  assert.equal(result.action, "needs_review");
  assert.equal(result.candidate?.id, "invoice-1");
  assert.match(result.reasons.join(","), /same_supplier/);
});

test("invoice backfill treats clear existing invoice as duplicate", () => {
  const result = decideSupplierPaymentInvoiceBackfill({
    payment: {
      id: "payment-4",
      clientId: "client-1",
      supplier: "Acme Customer",
      invoiceNumber: "INV-2001",
      amount: 1200,
      date: new Date("2026-06-01T10:00:00.000Z"),
      documentTypeDetailed: "invoice",
      source: "customer_invoice",
      subject: "Customer invoice INV-2001",
    },
    invoiceCandidates: [
      {
        id: "invoice-2",
        supplierName: "acme customer",
        invoiceNumber: "Invoice INV-2001",
        amount: 1200,
        date: new Date("2026-06-02T12:00:00.000Z"),
      },
    ],
  });

  assert.equal(result.action, "duplicate");
  assert.equal(result.candidate?.id, "invoice-2");
});
