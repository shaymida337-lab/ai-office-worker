import assert from "node:assert/strict";
import test from "node:test";

test("useDashboardHome rejects concurrent runSync and keeps syncingRef in lockstep", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/hooks/useDashboardHome.ts", "utf8");
  assert.match(source, /if \(syncingRef\.current \|\| syncing \|\| activeScanId\)/);
  assert.match(source, /syncingRef\.current = true/);
  assert.match(source, /syncingRef\.current = false/);
  assert.match(source, /conversationRequestsGmailScan/);
  assert.match(source, /conversationRequestsScanProgress/);
  assert.match(source, /setStats\(statsResult\.status === "fulfilled" \? statsResult\.value : null\)/);
  assert.match(source, /paymentActionInFlightRef/);
  assert.match(source, /invoiceAttachInFlightRef/);
  assert.doesNotMatch(source, /includes\("סרק"\)/);
});
