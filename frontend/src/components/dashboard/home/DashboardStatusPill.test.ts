import assert from "node:assert/strict";
import test from "node:test";

test("DashboardStatusPill is compact, RTL-safe, and accessible", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/home/DashboardStatusPill.tsx", "utf8");
  assert.match(source, /data-testid="dashboard-status-pill"/);
  assert.match(source, /aria-label=\{`מצב המערכת:/);
  assert.match(source, /min-h-11/);
  assert.match(source, /truncate/);
  assert.match(source, /max-w-full/);
  assert.doesNotMatch(source, /DashboardSystemHealthCard/);
  assert.doesNotMatch(source, /sectionTitle.*מצב המערכת/);
});

test("Dashboard page uses status pill instead of system health card", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/app/dashboard/page.tsx", "utf8");
  assert.match(source, /DashboardHomeStatus/);
  assert.doesNotMatch(source, /DashboardSystemHealthCard/);
});
