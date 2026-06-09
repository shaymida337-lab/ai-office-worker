import test from "node:test";
import assert from "node:assert/strict";
import {
  INVOICE_DRIVE_FOLDER_NAME,
  buildInvoiceDriveFilename,
  buildInvoiceDriveFolderPath,
} from "./driveService.js";

test("builds invoice Drive path under client supplier month hierarchy", () => {
  const path = buildInvoiceDriveFolderPath({
    clientName: "Shay Mida",
    supplierName: "Acme Ltd",
    documentDate: new Date("2026-06-09T10:30:00.000Z"),
  });

  assert.equal(INVOICE_DRIVE_FOLDER_NAME, "AI Office Worker");
  assert.equal(path, "AI Office Worker/Clients/Shay Mida/Suppliers/Acme Ltd/2026-06");
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
