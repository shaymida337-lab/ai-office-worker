import test from "node:test";
import assert from "node:assert/strict";

import {
  expandInvoiceSearchTerms,
  mapSupplierPaymentToShowInvoiceItem,
  mergeShowInvoiceItems,
  selectNatalieInvoiceDriveUrl,
} from "./natalie.js";

test("show_invoice uses driveFileUrl when driveUrl is missing", () => {
  const driveUrl = selectNatalieInvoiceDriveUrl({
    driveFileUrl: "https://drive.google.com/file/d/drive-file-id/view",
    driveUrl: null,
  });

  assert.equal(driveUrl, "https://drive.google.com/file/d/drive-file-id/view");
});

test("expands Pango supplier aliases bidirectionally", () => {
  assert.ok(expandInvoiceSearchTerms("פנגו").includes("Pango"));
  assert.ok(expandInvoiceSearchTerms("Pango").includes("פנגו"));
});

test("maps SupplierPayment to show_invoice item shape", () => {
  const date = new Date("2026-06-01T00:00:00.000Z");
  const item = mapSupplierPaymentToShowInvoiceItem({
    id: "payment-1",
    supplier: "Pango",
    supplierName: null,
    invoiceNumber: "P-100",
    amount: 144,
    currency: "ILS",
    date,
    dueDate: null,
    paid: false,
    driveFileUrl: null,
    invoiceLink: "https://drive.google.com/pango",
    documentLink: null,
  });

  assert.equal(item.id, "supplier-payment:payment-1");
  assert.equal(item.supplierName, "Pango");
  assert.equal(item.amount, 144);
  assert.equal(item.driveUrl, "https://drive.google.com/pango");
});

test("dedupes SupplierPayment duplicate of existing Invoice show_invoice item", () => {
  const date = new Date("2026-06-01T00:00:00.000Z");
  const invoice = {
    id: "invoice-1",
    supplierName: "Pango",
    invoiceNumber: "P-100",
    amount: 144,
    currency: "ILS",
    issueDate: date,
    dueDate: null,
    status: "pending",
    driveUrl: "https://drive.google.com/invoice",
  };
  const payment = {
    ...invoice,
    id: "supplier-payment:payment-1",
    driveUrl: "https://drive.google.com/payment",
  };

  assert.deepEqual(mergeShowInvoiceItems([invoice], [payment], 5), [invoice]);
});

test("caps merged show_invoice items at the requested limit", () => {
  const date = new Date("2026-06-01T00:00:00.000Z");
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `supplier-payment:${index}`,
    supplierName: `Supplier ${index}`,
    invoiceNumber: `INV-${index}`,
    amount: index + 1,
    currency: "ILS",
    issueDate: date,
    dueDate: null,
    status: "pending",
    driveUrl: null,
  }));

  assert.equal(mergeShowInvoiceItems([], items, 5).length, 5);
});
