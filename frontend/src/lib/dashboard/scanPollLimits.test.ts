import test from "node:test";
import assert from "node:assert/strict";
import { MAX_GMAIL_SCAN_POLL_ATTEMPTS, GMAIL_SCAN_POLL_INTERVAL_MS } from "./scanPollLimits.js";

test("gmail scan poll limits cover 30 minutes at 5 second interval", () => {
  assert.equal(GMAIL_SCAN_POLL_INTERVAL_MS, 5000);
  assert.equal(MAX_GMAIL_SCAN_POLL_ATTEMPTS * GMAIL_SCAN_POLL_INTERVAL_MS, 30 * 60 * 1000);
});
