import test from "node:test";
import assert from "node:assert/strict";

import { expandInvoiceSearchTerms, selectNatalieInvoiceDriveUrl } from "./natalie.js";

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
