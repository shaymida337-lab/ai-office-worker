import assert from "node:assert/strict";
import test from "node:test";

test("dashboard QA guard defaults to production port 3011", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("_visual-qa/dashboard-qa-guard.mjs", "utf8");
  assert.match(source, /DASHBOARD_VISUAL_QA_PORT = 3011/);
  assert.match(source, /assertDashboardServerReady/);
  assert.match(source, /Internal Server Error/);
});

test("production smoke script clears .next before build", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("_visual-qa/dashboard-production-smoke.mjs", "utf8");
  assert.match(source, /rm\(NEXT_DIR/);
  assert.match(source, /npm run build/);
  assert.match(source, /DASHBOARD_VISUAL_QA_PORT/);
  assert.match(source, /assertDashboardServerReady/);
});

test("phase7 compare preflights server health before screenshots", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("_visual-qa/dashboard-phase7-compare.mjs", "utf8");
  assert.match(source, /assertDashboardServerReady\(BASE\)/);
  assert.match(source, /DASHBOARD_VISUAL_QA_BASE/);
});

test("dashboard auth rejects server error pages before waiting for hero", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("_visual-qa/dashboard-auth.mjs", "utf8");
  assert.match(source, /assertDashboardServerReady/);
  assert.match(source, /isDashboardServerErrorBody/);
  assert.match(source, /status >= 500/);
});
