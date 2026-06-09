import test from "node:test";
import assert from "node:assert/strict";
import {
  INVOICE_DRIVE_FOLDER_NAME,
  buildInvoiceDriveFilename,
  buildInvoiceDriveFolderPath,
} from "./driveService.js";

test("builds supplier invoice Drive path under frozen year month hierarchy", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Acme Ltd",
    documentType: "invoice",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(INVOICE_DRIVE_FOLDER_NAME, "AI Office Worker");
  assert.equal(path, "AI Office Worker/Clients/Shay Mida/2026/06 - יוני/חשבוניות ספקים/Acme Ltd");
});

test("builds receipt Drive path without supplier folder", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Acme Ltd",
    documentType: "receipt",
    documentDate: new Date("2026-01-15T10:30:00.000Z"),
  });

  assert.equal(path, "AI Office Worker/Clients/Shay Mida/2026/01 - ינואר/קבלות תשלום");
});

test("routes needs review documents before document type category", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Acme Ltd",
    documentType: "invoice",
    reviewStatus: "needs_review",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(path, "AI Office Worker/Clients/Shay Mida/2026/06 - יוני/דורש בדיקה");
});

test("builds Hebrew fallback names and sanitizes folder separators", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Unknown Client",
    supplierName: "Unknown supplier / Tel Aviv",
    documentType: "invoice",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(path, "AI Office Worker/Clients/לקוח לא מזוהה/2026/06 - יוני/חשבוניות ספקים/ספק לא מזוהה - Tel Aviv");
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
