import assert from "node:assert/strict";
import test from "node:test";

test("DashboardQuickActions renders exactly three primary actions", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/DashboardQuickActions.tsx", "utf8");
  assert.match(source, /actions\.slice\(0, 3\)/);
  assert.match(source, /data-testid="dashboard-quick-actions"/);
});

test("DashboardQuickActions labels match approved copy", async () => {
  const { DASHBOARD_QUICK_ACTION_LABELS } = await import("./DashboardQuickActions.js");
  assert.deepEqual(DASHBOARD_QUICK_ACTION_LABELS, ["שאל את נטלי", "סרוק מיילים", "העלה מסמך"]);
});

test("DashboardQuickActions uses equal mobile 2+1 and desktop one-row grid", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/DashboardQuickActions.tsx", "utf8");
  assert.match(source, /grid-cols-2/);
  assert.match(source, /sm:grid-cols-3/);
  assert.match(source, /col-span-2 sm:col-span-1/);
  assert.match(source, /min-h-11/);
});

test("DashboardQuickActions buttons are equal and accessible", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/DashboardQuickActions.tsx", "utf8");
  assert.doesNotMatch(source, /primary\?/);
  assert.doesNotMatch(source, /col-span-2 md:col-span-1/);
  assert.match(source, /h-5 w-5/);
  assert.match(source, /focus-visible:outline/);
  assert.match(source, /aria-label=\{action\.label\}/);
});
