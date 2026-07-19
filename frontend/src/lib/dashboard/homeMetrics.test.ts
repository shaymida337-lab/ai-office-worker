import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_NO_DATA_LABEL,
  formatDashboardMetricValue,
  snapshotFromHomeMetrics,
} from "./homeMetrics.ts";

test("snapshotFromHomeMetrics maps API payload to dashboard keys", () => {
  const snapshot = snapshotFromHomeMetrics({
    organizationId: "org-1",
    computedAt: "2026-07-15T10:00:00.000Z",
    timeZone: "Asia/Jerusalem",
    metrics: {
      active_clients: 7,
      open_tasks: 5,
      meetings_today: 3,
      pending_docs: 4,
      new_clients_this_month: 2,
      unread_alerts: 1,
    },
    definitions: {
      active_clients: "",
      open_tasks: "",
      meetings_today: "",
      pending_docs: "",
      new_clients_this_month: "",
      unread_alerts: "",
    },
  });
  assert.deepEqual(snapshot, {
    active_clients: 7,
    open_tasks: 5,
    meetings_today: 3,
    pending_docs: 4,
    new_clients_month: 2,
  });
});

test("formatDashboardMetricValue never fabricates zero on missing data", () => {
  assert.equal(formatDashboardMetricValue(null, false), DASHBOARD_NO_DATA_LABEL);
  assert.equal(formatDashboardMetricValue(undefined, true), "—");
  assert.equal(formatDashboardMetricValue(0, false), "0");
});

test("home-metrics early apply unlocks KPI before sibling critical settles", async () => {
  // Mirrors useDashboardHome load(): same promise in allSettled + early then,
  // without re-applying after await criticalPromise.
  let homeMetrics: { active_clients: number } | null = null;
  let homeMetricsLoaded = false;
  let applyCount = 0;
  let slowCriticalDone = false;

  const homeMetricsPromise: Promise<{ active_clients: number }> = Promise.resolve({ active_clients: 41 });
  void homeMetricsPromise.then(
    (value) => {
      homeMetrics = value;
      homeMetricsLoaded = true;
      applyCount += 1;
    },
    () => {
      homeMetrics = null;
      homeMetricsLoaded = true;
      applyCount += 1;
    }
  );

  const slowCritical = new Promise<string>((resolve) => {
    setTimeout(() => {
      slowCriticalDone = true;
      resolve("stats");
    }, 40);
  });

  const criticalPromise = Promise.allSettled([slowCritical, homeMetricsPromise] as const);

  await homeMetricsPromise;
  await Promise.resolve();

  assert.equal(homeMetricsLoaded, true);
  assert.equal(homeMetrics?.active_clients, 41);
  assert.equal(slowCriticalDone, false);
  assert.equal(formatDashboardMetricValue(homeMetrics?.active_clients, !homeMetricsLoaded), "41");

  await criticalPromise;
  // Do not re-apply after await (avoids double setState in the hook).
  assert.equal(applyCount, 1);
  assert.equal(slowCriticalDone, true);
});

test("home-metrics early apply marks loaded on rejection without fake metrics", async () => {
  let homeMetrics: { active_clients: number } | null = { active_clients: -1 };
  let homeMetricsLoaded = false;

  const homeMetricsPromise: Promise<{ active_clients: number }> = Promise.reject(new Error("home-metrics failed"));
  void homeMetricsPromise.then(
    (value) => {
      homeMetrics = value;
      homeMetricsLoaded = true;
    },
    () => {
      homeMetrics = null;
      homeMetricsLoaded = true;
    }
  );

  await Promise.allSettled([homeMetricsPromise]);
  await Promise.resolve();

  assert.equal(homeMetricsLoaded, true);
  assert.equal(homeMetrics, null);
  assert.equal(formatDashboardMetricValue(null, !homeMetricsLoaded), DASHBOARD_NO_DATA_LABEL);
});
