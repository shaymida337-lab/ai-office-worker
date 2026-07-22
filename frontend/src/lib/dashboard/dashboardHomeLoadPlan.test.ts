import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDashboardHomeFirstPaintBudget,
  DASHBOARD_HOME_BACKGROUND_KEYS,
  DASHBOARD_HOME_FIRST_PAINT_FORBIDDEN_KEYS,
  DASHBOARD_HOME_FIRST_PAINT_KEYS,
  runDashboardHomeLoadPhases,
} from "./dashboardHomeLoadPlan.ts";

test("dashboard First Paint is at most 4 light keys", () => {
  assert.equal(DASHBOARD_HOME_FIRST_PAINT_KEYS.length, 4);
  assertDashboardHomeFirstPaintBudget();
  for (const key of DASHBOARD_HOME_FIRST_PAINT_KEYS) {
    assert.equal(
      (DASHBOARD_HOME_FIRST_PAINT_FORBIDDEN_KEYS as readonly string[]).includes(key),
      false,
      `First Paint must not include ${key}`
    );
  }
});

test("dashboard Background keeps heavy endpoints out of First Paint", () => {
  for (const heavy of [
    "stats",
    "document-reviews-summary",
    "summary-daily",
    "system-health",
    "accountant-summary",
    "invoices-incomplete",
    "payments",
  ] as const) {
    assert.ok(DASHBOARD_HOME_BACKGROUND_KEYS.includes(heavy));
    assert.equal((DASHBOARD_HOME_FIRST_PAINT_KEYS as readonly string[]).includes(heavy), false);
  }
});

test("First Paint ready fires before Background work", async () => {
  const order: string[] = [];
  await runDashboardHomeLoadPhases({
    loadFirstPaint: async () => {
      order.push("fp-start");
      await Promise.resolve();
      order.push("fp-end");
    },
    onFirstPaintReady: () => {
      order.push("ready");
    },
    loadBackground: async () => {
      order.push("bg-start");
      await Promise.resolve();
      order.push("bg-end");
    },
  });
  assert.deepEqual(order, ["fp-start", "fp-end", "ready", "bg-start", "bg-end"]);
});

test("Background failure does not reject and does not skip First Paint ready", async () => {
  let ready = false;
  let backgroundError: unknown = null;
  await runDashboardHomeLoadPhases({
    loadFirstPaint: async () => undefined,
    onFirstPaintReady: () => {
      ready = true;
    },
    loadBackground: async () => {
      throw new Error("bg boom");
    },
    onBackgroundError: (error) => {
      backgroundError = error;
    },
  });
  assert.equal(ready, true);
  assert.ok(backgroundError instanceof Error);
  assert.match((backgroundError as Error).message, /bg boom/);
});

test("stale generation skips Background after First Paint", async () => {
  let backgroundRan = false;
  let current = true;
  await runDashboardHomeLoadPhases({
    isCurrent: () => current,
    loadFirstPaint: async () => {
      current = false;
    },
    onFirstPaintReady: () => {
      throw new Error("ready should not run when generation is stale");
    },
    loadBackground: async () => {
      backgroundRan = true;
    },
  });
  assert.equal(backgroundRan, false);
});
