import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_ACTIVITY_MOBILE_POLICY,
  DASHBOARD_KPI_GRID_CLASSES,
  DASHBOARD_MIN_TOUCH_TARGET_CLASS,
  DASHBOARD_QUICK_ACTION_GRID_CLASSES,
  DASHBOARD_RESPONSIVE_BREAKPOINTS,
} from "./dashboardResponsive.js";

test("responsive breakpoints include Phase 7 targets", () => {
  assert.deepEqual(DASHBOARD_RESPONSIVE_BREAKPOINTS, [390, 430, 768, 1024, 1366, 1600, 1920]);
});

test("KPI grid keeps 2x2 until lg then 4 across", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/BusinessSnapshot.tsx", "utf8");
  assert.match(source, /grid-cols-2/);
  assert.match(source, /lg:grid-cols-4/);
  assert.match(source, /auto-rows-fr/);
});

test("quick actions use 2+1 below 430 and three columns from 430", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/DashboardQuickActions.tsx", "utf8");
  assert.match(source, /min-\[430px\]:grid-cols-3/);
  assert.match(source, /min-\[430px\]:col-span-1/);
});

test("status pill truncates gracefully on narrow screens", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/home/DashboardStatusPill.tsx", "utf8");
  assert.match(source, /truncate/);
  assert.match(source, /max-w-full/);
  assert.match(source, /min-h-11/);
});

test("today rows truncate long copy and keep icon visible", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieYourDay.tsx", "utf8");
  assert.match(source, /shrink-0/);
  assert.match(source, /line-clamp-2/);
  assert.match(source, /min-h-11/);
});

test("hero recommendation wraps without forcing nowrap", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/NatalieMorningBrief.tsx", "utf8");
  assert.match(source, /break-words/);
  assert.doesNotMatch(source, /whitespace-nowrap/);
});

test("activity timeline mobile hide policy is documented on dashboard page", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile("src/app/dashboard/page.tsx", "utf8");
  assert.match(page, /hidden md:block/);
  assert.match(page, /data-activity-mobile="hidden"/);
  assert.match(DASHBOARD_ACTIVITY_MOBILE_POLICY, /768px/);
});

test("dashboard shell prevents horizontal scroll", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile("src/app/dashboard/page.tsx", "utf8");
  const css = await readFile("src/app/globals.css", "utf8");
  assert.match(page, /overflow-x-clip|overflow-x-hidden/);
  assert.match(css, /\.dashboard-shell/);
  assert.match(css, /overflow-x:\s*clip/);
});

test("interactive dashboard controls meet minimum touch target class", async () => {
  const { readFile } = await import("node:fs/promises");
  const quickActions = await readFile("src/components/dashboard/DashboardQuickActions.tsx", "utf8");
  const commandBar = await readFile("src/components/dashboard/NatalieCommandBar.tsx", "utf8");
  assert.match(quickActions, new RegExp(DASHBOARD_MIN_TOUCH_TARGET_CLASS));
  assert.match(commandBar, new RegExp(DASHBOARD_MIN_TOUCH_TARGET_CLASS));
});
