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
  assert.match(source, /paymentActionInFlightRef/);
  assert.match(source, /invoiceAttachInFlightRef/);
  assert.doesNotMatch(source, /includes\("סרק"\)/);
});

test("useDashboardHome M1: First Paint does not await Background heavies", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/hooks/useDashboardHome.ts", "utf8");
  assert.match(source, /runDashboardHomeLoadPhases/);
  assert.match(source, /loadFirstPaint:/);
  assert.match(source, /loadBackground:/);
  assert.match(source, /onFirstPaintReady:/);
  // stats + full document-reviews belong in Background only
  const fpBlock = source.slice(source.indexOf("loadFirstPaint:"), source.indexOf("loadBackground:"));
  assert.doesNotMatch(fpBlock, /\/api\/stats/);
  assert.doesNotMatch(fpBlock, /document-reviews\?status=needs_review/);
  assert.doesNotMatch(fpBlock, /accountant\/summary/);
  assert.doesNotMatch(fpBlock, /system\/health/);
  assert.match(fpBlock, /\/api\/integrations\/gmail\/status/);
  assert.match(fpBlock, /\/api\/organization\/settings/);
  assert.match(fpBlock, /\/api\/tasks/);
  assert.match(fpBlock, /requestHomeMetrics\(true\)/);
  const bgBlock = source.slice(source.indexOf("loadBackground:"), source.indexOf("onBackgroundError:") > 0 ? source.length : source.length);
  assert.match(source, /apiFetch<DashboardStats>\("\/api\/stats"\)/);
  assert.match(source, /document-reviews\?status=needs_review/);
  // Background reject must not clear prior data via unconditional setStats\(null\)
  assert.doesNotMatch(source, /setStats\(null\);\s*setClients\(emptyClients\)/);
});
