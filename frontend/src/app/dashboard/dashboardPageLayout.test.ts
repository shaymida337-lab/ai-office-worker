import assert from "node:assert/strict";
import test from "node:test";

test("dashboard page section order follows Phase 6 rhythm", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/app/dashboard/page.tsx", "utf8");

  const heroIndex = source.indexOf("<NatalieMorningBrief");
  const statusIndex = source.indexOf("<DashboardHomeStatus");
  const kpiIndex = source.indexOf("<BusinessSnapshot");
  const todayIndex = source.indexOf("<NatalieYourDay");
  const quickActionsIndex = source.indexOf("<DashboardQuickActions");
  const activityIndex = source.indexOf("<DashboardActivityTimeline");
  const integrationsIndex = source.indexOf("<IntegrationStatusCard");

  assert.ok(heroIndex >= 0 && statusIndex > heroIndex, "status follows hero");
  assert.ok(kpiIndex > statusIndex, "kpis follow status");
  assert.ok(todayIndex > kpiIndex, "today follows kpis");
  assert.ok(quickActionsIndex > todayIndex, "quick actions follow today");
  assert.ok(activityIndex > quickActionsIndex, "activity follows quick actions");
  assert.ok(integrationsIndex > activityIndex, "integrations follow activity");
});

test("dashboard page uses three quick actions and removes smart suggestion chips", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/app/dashboard/page.tsx", "utf8");
  assert.doesNotMatch(source, /NatalieSmartSuggestions/);
  assert.match(source, /DashboardQuickActions/);
  assert.match(source, /ask-natalie/);
  assert.match(source, /scan-email/);
  assert.match(source, /upload-document/);
  assert.match(source, /dashboard-home-stack/);
});

test("dashboard page keeps command bar without duplicate suggestion chips", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/app/dashboard/page.tsx", "utf8");
  assert.match(source, /NatalieCommandBar/);
  assert.match(source, /suggestions=\{\[\]\}/);
  assert.match(source, /id="natalie-command"/);
});
