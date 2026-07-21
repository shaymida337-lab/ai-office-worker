import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_NO_DATA_LABEL,
  formatDashboardMetricValue,
  requestHomeMetricsWithRetry,
  snapshotFromHomeMetrics,
  type DashboardHomeMetricsResponse,
} from "./homeMetrics.ts";

function metricsPayload(activeClients: number): DashboardHomeMetricsResponse {
  return {
    organizationId: "org-1",
    computedAt: "2026-07-21T08:00:00.000Z",
    timeZone: "Asia/Jerusalem",
    metrics: {
      active_clients: activeClients,
      open_tasks: 0,
      meetings_today: 0,
      pending_docs: 0,
      new_clients_this_month: 0,
      unread_alerts: 0,
    },
    definitions: {
      active_clients: "",
      open_tasks: "",
      meetings_today: "",
      pending_docs: "",
      new_clients_this_month: "",
      unread_alerts: "",
    },
  };
}

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

test("home-metrics loading state shows em-dash, never no-data label", () => {
  // Mirrors the hook before requestHomeMetrics settles: loaded=false.
  const homeMetricsLoaded = false;
  assert.equal(formatDashboardMetricValue(undefined, !homeMetricsLoaded), "—");
  assert.equal(formatDashboardMetricValue(null, !homeMetricsLoaded), "—");
});

test("home-metrics success applies payload without retry", async () => {
  let attempts = 0;
  const outcome = await requestHomeMetricsWithRetry(async () => {
    attempts += 1;
    return metricsPayload(41);
  });

  assert.equal(outcome.state, "success");
  assert.equal(attempts, 1);
  if (outcome.state === "success") {
    // success => loaded=true; real values render, and a genuine empty value
    // (non-finite) is the only case that shows the no-data label.
    assert.equal(formatDashboardMetricValue(outcome.payload.metrics.active_clients, false), "41");
    assert.equal(formatDashboardMetricValue(null, false), DASHBOARD_NO_DATA_LABEL);
  }
});

test("home-metrics timeout/error: one auto-retry, then explicit error (not no-data)", async () => {
  let attempts = 0;
  const waits: number[] = [];
  const outcome = await requestHomeMetricsWithRetry(
    async () => {
      attempts += 1;
      throw new Error("timeout");
    },
    { retryDelayMs: 2500, wait: async (ms) => { waits.push(ms); } }
  );

  assert.equal(outcome.state, "error");
  assert.equal(attempts, 2); // exactly one automatic retry
  assert.deepEqual(waits, [2500]);
  // On error the hook keeps loaded=false => cells show "—", never "אין נתונים".
  assert.equal(formatDashboardMetricValue(null, true), "—");
});

test("home-metrics auto-retry recovers when second attempt succeeds", async () => {
  let attempts = 0;
  const outcome = await requestHomeMetricsWithRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("cold start");
      return metricsPayload(7);
    },
    { wait: async () => undefined }
  );

  assert.equal(outcome.state, "success");
  assert.equal(attempts, 2);
});

test("home-metrics manual retry (autoRetry=false) makes a single attempt", async () => {
  let attempts = 0;
  const outcome = await requestHomeMetricsWithRetry(
    async () => {
      attempts += 1;
      throw new Error("still down");
    },
    { autoRetry: false, wait: async () => { throw new Error("wait must not be called"); } }
  );

  assert.equal(outcome.state, "error");
  assert.equal(attempts, 1);
});
