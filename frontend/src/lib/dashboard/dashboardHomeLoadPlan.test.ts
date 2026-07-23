import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDashboardHomeFirstPaintBudget,
  dashboardBootstrapUserFacingError,
  DASHBOARD_HOME_BACKGROUND_KEYS,
  DASHBOARD_HOME_FIRST_PAINT_FORBIDDEN_KEYS,
  DASHBOARD_HOME_FIRST_PAINT_KEYS,
  runDashboardHomeLoadPhases,
} from "./dashboardHomeLoadPlan.ts";

test("dashboard First Paint is a single bootstrap key", () => {
  assert.deepEqual([...DASHBOARD_HOME_FIRST_PAINT_KEYS], ["bootstrap"]);
  assertDashboardHomeFirstPaintBudget();
  for (const key of DASHBOARD_HOME_FIRST_PAINT_FORBIDDEN_KEYS) {
    assert.equal(
      (DASHBOARD_HOME_FIRST_PAINT_KEYS as readonly string[]).includes(key),
      false,
      `First Paint must not include ${key}`
    );
  }
});

test("bootstrap user-facing errors are Hebrew and do not hide failure", () => {
  const msg = dashboardBootstrapUserFacingError(new Error("Failed to load dashboard bootstrap"));
  assert.match(msg, /מסך הבית/);
  assert.notEqual(msg, "");
  assert.match(
    dashboardBootstrapUserFacingError({ message: "x", code: "BOOTSTRAP_PAYLOAD_TOO_LARGE" }),
    /גדולים/
  );
});

test("dashboard Background keeps heavy endpoints out of First Paint", () => {
  for (const key of DASHBOARD_HOME_BACKGROUND_KEYS) {
    assert.equal((DASHBOARD_HOME_FIRST_PAINT_KEYS as readonly string[]).includes(key), false);
  }
});

test("First Paint ready fires before Background work", async () => {
  const events: string[] = [];
  await runDashboardHomeLoadPhases({
    loadFirstPaint: async () => {
      events.push("fp");
    },
    onFirstPaintReady: () => {
      events.push("ready");
    },
    loadBackground: async () => {
      events.push("bg");
    },
  });
  assert.deepEqual(events, ["fp", "ready", "bg"]);
});

test("Background failure does not reject and does not skip First Paint ready", async () => {
  const events: string[] = [];
  await runDashboardHomeLoadPhases({
    loadFirstPaint: async () => undefined,
    onFirstPaintReady: () => {
      events.push("ready");
    },
    loadBackground: async () => {
      throw new Error("bg fail");
    },
    onBackgroundError: () => {
      events.push("bg-error");
    },
  });
  assert.deepEqual(events, ["ready", "bg-error"]);
});

test("stale generation skips Background after First Paint", async () => {
  const events: string[] = [];
  let current = true;
  await runDashboardHomeLoadPhases({
    isCurrent: () => current,
    loadFirstPaint: async () => {
      events.push("fp");
      current = false;
    },
    onFirstPaintReady: () => {
      events.push("ready");
    },
    loadBackground: async () => {
      events.push("bg");
    },
  });
  assert.deepEqual(events, ["fp"]);
});
