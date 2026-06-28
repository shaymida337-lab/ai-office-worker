import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFastScanExcludeQuery,
  buildFastScanQueries,
  FAST_SCAN_DATE_FILTER,
} from "./gmailFastScanQuery.js";

test("fast scan uses 24h window instead of 2h", () => {
  assert.equal(FAST_SCAN_DATE_FILTER, "newer_than:1d");
  for (const query of buildFastScanQueries()) {
    assert.match(query, /^newer_than:1d /);
    assert.doesNotMatch(query, /newer_than:2h/);
  }
});

test("fast scan exclude query does not drop promotions or social categories", () => {
  const exclude = buildFastScanExcludeQuery();
  assert.match(exclude, /-in:spam/);
  assert.match(exclude, /-in:trash/);
  assert.doesNotMatch(exclude, /category:promotions/);
  assert.doesNotMatch(exclude, /category:social/);
});

test("fast scan queries cover attachment invoices sent mail and image filenames", () => {
  const queries = buildFastScanQueries();
  assert.ok(queries.some((q) => q.includes("has:attachment") && !q.includes("in:sent")));
  assert.ok(queries.some((q) => q.includes("in:sent") && q.includes("has:attachment")));
  assert.ok(queries.some((q) => q.includes("filename:jpg") && q.includes("filename:pdf")));
  assert.ok(queries.some((q) => q.includes("subject:invoice") && q.includes("has:attachment")));
  assert.ok(queries.some((q) => q.includes("subject:חשבונית") && q.includes("has:attachment")));
  assert.ok(
    queries.some(
      (q) =>
        q.includes("has:attachment") &&
        q.includes("invoice") &&
        q.includes("חשבונית")
    )
  );
});

test("fast scan scanAllMail keeps spam and trash exclusions only", () => {
  assert.equal(buildFastScanExcludeQuery({ scanAllMail: true }), "-in:spam -in:trash");
});
