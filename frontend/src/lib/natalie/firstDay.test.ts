import test from "node:test";
import assert from "node:assert/strict";
import { consumeFirstDashboardVisit, markFirstDashboardVisit, FIRST_DASHBOARD_VISIT_KEY } from "./firstDay.js";

test("markFirstDashboardVisit and consumeFirstDashboardVisit are one-shot", () => {
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    sessionStorage: {
      setItem: (key: string, value: string) => storage.set(key, value),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    },
  };
  // @ts-expect-error test shim
  globalThis.window.sessionStorage = globalThis.window.sessionStorage;

  try {
    markFirstDashboardVisit();
    assert.equal(storage.get(FIRST_DASHBOARD_VISIT_KEY), "1");
    assert.equal(consumeFirstDashboardVisit(), true);
    assert.equal(consumeFirstDashboardVisit(), false);
    assert.equal(storage.has(FIRST_DASHBOARD_VISIT_KEY), false);
  } finally {
    globalThis.window = originalWindow;
  }
});
