import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildGmailCandidateSearchQueries,
  GMAIL_INVOICE_ATTACHMENT_KEYWORD_OR,
} from "./gmail-sync.js";
import { GMAIL_SCAN_PREEMPTIBLE_MODES } from "./gmailScanLifecycle.js";

const here = dirname(fileURLToPath(import.meta.url));

test("historical/full scan search includes has:attachment invoice keywords and all-mail fallback", () => {
  const queries = buildGmailCandidateSearchQueries({
    dateFilter: "after:2025/01/01",
    scanAllMail: true,
  });
  assert.equal(queries.length, 2);
  assert.match(queries[0]!, /has:attachment/);
  assert.match(queries[0]!, /חשבונית/);
  assert.match(queries[0]!, /invoice/);
  assert.equal(queries[1], "after:2025/01/01 -in:spam -in:trash");
  assert.match(GMAIL_INVOICE_ATTACHMENT_KEYWORD_OR, /קבלה/);
});

test("incremental scan search still uses keyword + supplier queries", () => {
  const queries = buildGmailCandidateSearchQueries({
    dateFilter: "newer_than:30d",
    scanAllMail: false,
  });
  assert.ok(queries.length >= 2);
  assert.match(queries[0]!, /has:attachment/);
});

test("fast_recurring is preemptible for historical scans", () => {
  assert.ok(GMAIL_SCAN_PREEMPTIBLE_MODES.includes("fast_recurring"));
  assert.ok(GMAIL_SCAN_PREEMPTIBLE_MODES.includes("manual_incremental"));
});

test("POST /api/gmail/scan preempts fast scans before historical start", () => {
  const apiSource = readFileSync(join(here, "../routes/api.ts"), "utf8");
  assert.match(apiSource, /preemptPreemptibleGmailScansForOrg/);
  assert.match(apiSource, /useHistoricalScan \|\| fullScan \|\| rescanInvoices/);
});

test("gmail-sync logs historical start and Gmail q= search string", () => {
  const syncSource = readFileSync(join(here, "gmail-sync.ts"), "utf8");
  assert.match(syncSource, /Starting Gmail historical scan for daysBack=/);
  assert.match(syncSource, /Gmail API returned \$\{.*\} total messages for query/);
  assert.match(syncSource, /Searching Gmail q="/);
  assert.match(syncSource, /Gmail OAuth token invalid or expired/);
});
