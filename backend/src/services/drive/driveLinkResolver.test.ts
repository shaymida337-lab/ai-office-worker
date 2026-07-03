import test from "node:test";
import assert from "node:assert/strict";
import { hasDriveLink, isLocalUploadLink, resolveDriveLink } from "./driveLinkResolver.js";

test("resolveDriveLink: reads each model's field shape (bidirectional)", () => {
  // GmailScanItem
  assert.equal(resolveDriveLink({ driveFileLink: "https://drive.google.com/a" }), "https://drive.google.com/a");
  // EmailAttachment
  assert.equal(resolveDriveLink({ driveLink: "https://drive.google.com/b" }), "https://drive.google.com/b");
  // FinancialDocumentReview / SupplierPayment
  assert.equal(resolveDriveLink({ driveFileUrl: "https://drive.google.com/c" }), "https://drive.google.com/c");
  // Invoice (legacy driveUrl)
  assert.equal(resolveDriveLink({ driveUrl: "https://drive.google.com/d" }), "https://drive.google.com/d");
  // SupplierPayment fallbacks
  assert.equal(resolveDriveLink({ invoiceLink: "https://drive.google.com/e" }), "https://drive.google.com/e");
  assert.equal(resolveDriveLink({ documentLink: "https://drive.google.com/f" }), "https://drive.google.com/f");
  // אין קישור בכלל
  assert.equal(resolveDriveLink({}), null);
  assert.equal(resolveDriveLink(null), null);
  assert.equal(resolveDriveLink({ driveFileUrl: "  ", driveUrl: "" }), null);
});

test("resolveDriveLink: precedence prefers canonical field over legacy fallbacks", () => {
  assert.equal(
    resolveDriveLink({
      documentLink: "https://drive.google.com/doc",
      driveFileUrl: "https://drive.google.com/canonical",
      driveUrl: "https://drive.google.com/legacy",
    }),
    "https://drive.google.com/canonical"
  );
  assert.equal(
    resolveDriveLink({ driveUrl: "https://drive.google.com/legacy", invoiceLink: "https://drive.google.com/inv" }),
    "https://drive.google.com/legacy"
  );
});

test("isLocalUploadLink / hasDriveLink: camera local files are not Drive links", () => {
  assert.equal(isLocalUploadLink("/uploads/camera-invoices/123_scan.jpg"), true);
  assert.equal(isLocalUploadLink("https://drive.google.com/x"), false);
  assert.equal(isLocalUploadLink(null), false);
  // רשומת מצלמה עם קובץ מקומי בלבד — אין לה Drive
  assert.equal(hasDriveLink({ driveFileUrl: "/uploads/camera-invoices/1_a.pdf" }), false);
  // רשומה עם קישור אמיתי — יש
  assert.equal(hasDriveLink({ driveFileUrl: "https://drive.google.com/y" }), true);
  assert.equal(hasDriveLink({}), false);
});
