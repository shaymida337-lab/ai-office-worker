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
  // stats + document-reviews summary belong in Background only
  const fpBlock = source.slice(source.indexOf("loadFirstPaint:"), source.indexOf("loadBackground:"));
  assert.doesNotMatch(fpBlock, /\/api\/stats/);
  assert.doesNotMatch(fpBlock, /document-reviews\?/);
  assert.doesNotMatch(fpBlock, /accountant\/summary/);
  assert.doesNotMatch(fpBlock, /system\/health/);
  assert.doesNotMatch(fpBlock, /\/api\/integrations\/gmail\/status/);
  assert.doesNotMatch(fpBlock, /\/api\/dashboard\/home-metrics/);
  assert.doesNotMatch(fpBlock, /\/api\/tasks"/);
  assert.doesNotMatch(fpBlock, /\/api\/organization\/settings/);
  assert.match(fpBlock, /loadDashboardBootstrap/);
  assert.match(fpBlock, /\/api\/dashboard\/bootstrap|loadDashboardBootstrap/);
  assert.match(source, /apiFetch<DashboardStats>\("\/api\/stats"\)/);
  assert.match(source, /document-reviews\?status=needs_review&view=summary/);
  assert.doesNotMatch(source, /setStats\(null\);\s*setClients\(emptyClients\)/);
});
