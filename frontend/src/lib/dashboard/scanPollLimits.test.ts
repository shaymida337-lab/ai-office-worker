import test from "node:test";
import assert from "node:assert/strict";
import { SCAN_CLIENT_STUCK_TIMEOUT_MS } from "@/lib/gmailScanLifecycle";
import {
  MAX_GMAIL_SCAN_POLL_ATTEMPTS,
  GMAIL_SCAN_POLL_INTERVAL_MS,
} from "./scanPollLimits.js";

test("gmail scan poll limits hard-stop at 3 minute stuck timeout", () => {
  assert.equal(GMAIL_SCAN_POLL_INTERVAL_MS, 5000);
  assert.equal(SCAN_CLIENT_STUCK_TIMEOUT_MS, 3 * 60 * 1000);
  assert.equal(
    MAX_GMAIL_SCAN_POLL_ATTEMPTS * GMAIL_SCAN_POLL_INTERVAL_MS,
    SCAN_CLIENT_STUCK_TIMEOUT_MS
  );
});
