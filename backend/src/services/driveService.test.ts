import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIVE_FOLDER_NAMES,
  INVOICE_DRIVE_FOLDER_NAME,
  buildInvoiceDriveFilename,
  buildInvoiceDriveFolderPath,
} from "./driveService.js";

test("builds supplier invoice Drive path under frozen supplier-first hierarchy", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Wolt",
    documentType: "invoice",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(INVOICE_DRIVE_FOLDER_NAME, "AI Office Worker");
  assert.equal(DRIVE_FOLDER_NAMES.suppliers, "Suppliers");
  assert.equal(DRIVE_FOLDER_NAMES.invoices, "Invoices");
  assert.equal(path, "AI Office Worker/Clients/Shay Mida/2026/06 - יוני/Suppliers/Wolt/Invoices");
});

test("builds supplier receipt Drive path under supplier folder", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Super Pharm",
    documentType: "receipt",
    documentDate: new Date("2026-01-15T10:30:00.000Z"),
  });

  assert.equal(DRIVE_FOLDER_NAMES.receipts, "Receipts");
  assert.equal(path, "AI Office Worker/Clients/Shay Mida/2026/01 - ינואר/Suppliers/Super Pharm/Receipts");
});

test("routes needs review known supplier under supplier Needs Review", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Acme Ltd",
    documentType: "invoice",
    reviewStatus: "needs_review",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(DRIVE_FOLDER_NAMES.needsReview, "Needs Review");
  assert.equal(path, "AI Office Worker/Clients/Shay Mida/2026/06 - יוני/Suppliers/Acme Ltd/Needs Review");
});

test("routes unknown supplier to stable fallback Needs Review folder", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Unknown supplier",
    documentType: "invoice",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(DRIVE_FOLDER_NAMES.unknownSupplier, "לא זוהה");
  assert.equal(path, "AI Office Worker/Clients/Shay Mida/2026/06 - יוני/Suppliers/לא זוהה/Needs Review");
});

test("keeps Hebrew month format stable while sanitizing folder separators", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Unknown Client",
    supplierName: "Acme / Ltd",
    documentType: "tax_invoice_receipt",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(path, "AI Office Worker/Clients/לקוח לא מזוהה/2026/06 - יוני/Suppliers/Acme - Ltd/Invoices");
});

test("builds clean supplier invoice date amount filenames", () => {
  const filename = buildInvoiceDriveFilename(
    "Original Invoice.PDF",
    "Acme / Ltd",
    "INV 1001/26",
    new Date("2026-06-09T10:30:00.000Z"),
    120.5
  );

  assert.equal(filename, "Acme-Ltd_INV-1001-26_2026-06-09_120.5.pdf");
});

test("builds stable fallback invoice filenames", () => {
  const filename = buildInvoiceDriveFilename(
    "scan.jpeg",
    null,
    null,
    new Date("2026-06-09T10:30:00.000Z"),
    null
  );

  assert.equal(filename, "unknown-supplier_no-invoice-number_2026-06-09_unknown.jpeg");
});
