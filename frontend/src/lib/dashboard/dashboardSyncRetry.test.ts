import assert from "node:assert/strict";
import test from "node:test";
import {
  createDashboardSyncRetryRequest,
  DASHBOARD_GMAIL_SYNC_ENDPOINT,
  isDashboardSyncRetryRequest,
} from "./dashboardSyncRetry.js";

test("retry performs real gmail scan POST", () => {
  const request = createDashboardSyncRetryRequest();
  assert.equal(request.method, "POST");
  assert.equal(request.path, DASHBOARD_GMAIL_SYNC_ENDPOINT);
  assert.equal(isDashboardSyncRetryRequest(request), true);
});

test("retry is not a page refresh action", () => {
  assert.equal(isDashboardSyncRetryRequest({ method: "GET", path: "/dashboard" }), false);
  assert.equal(isDashboardSyncRetryRequest({ method: "POST", path: "/dashboard" }), false);
});

test("retry can include scan range for first scan flows", () => {
  const request = createDashboardSyncRetryRequest(90);
  assert.deepEqual(request.body, { daysBack: 90 });
});
