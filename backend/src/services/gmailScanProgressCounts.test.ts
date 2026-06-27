import test from "node:test";
import assert from "node:assert/strict";
import {
  documentsFoundFromScanItems,
  persistedDocumentsFound,
  resolveDocumentsFound,
} from "./gmailScanProgressCounts.js";

test("documentsFoundFromScanItems sums classified and needs-review rows", () => {
  assert.equal(documentsFoundFromScanItems(3, 5), 8);
  assert.equal(documentsFoundFromScanItems(0, 0), 0);
});

test("resolveDocumentsFound prefers live DB counts over stale log field", () => {
  assert.equal(
    resolveDocumentsFound({ classifiedCount: 2, rejectedCount: 4, persistedInvoicesFound: 0 }),
    6
  );
  assert.equal(
    resolveDocumentsFound({ classifiedCount: 0, rejectedCount: 0, persistedInvoicesFound: 7 }),
    7
  );
});

test("persistedDocumentsFound includes needs-review items saved during scan", () => {
  assert.equal(persistedDocumentsFound(0, 12), 12);
  assert.equal(persistedDocumentsFound(3, 5), 8);
});
