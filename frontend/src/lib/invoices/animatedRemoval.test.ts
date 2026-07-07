import test from "node:test";
import assert from "node:assert/strict";
import { removeRowAfterAction } from "./animatedRemoval.js";

function trackingDeps(overrides: Partial<Parameters<typeof removeRowAfterAction>[0]> = {}) {
  const calls: string[] = [];
  const errors: unknown[] = [];
  return {
    calls,
    errors,
    deps: {
      performAction: async () => {
        calls.push("performAction");
      },
      beginExitAnimation: () => {
        calls.push("beginExitAnimation");
      },
      waitForExitAnimation: async () => {
        calls.push("waitForExitAnimation");
      },
      finalize: async () => {
        calls.push("finalize");
      },
      endExitAnimation: () => {
        calls.push("endExitAnimation");
      },
      reportError: (error: unknown) => {
        calls.push("reportError");
        errors.push(error);
      },
      ...overrides,
    },
  };
}

test("row is not removed when the API call fails", async () => {
  const failure = new Error("לא ניתן לאשר מסמך — בדיקת אמון נכשלה (trust.amount_gate_missing)");
  const { calls, errors, deps } = trackingDeps({
    performAction: async () => {
      calls.push("performAction");
      throw failure;
    },
  });

  const removed = await removeRowAfterAction(deps);

  assert.equal(removed, false);
  assert.deepEqual(calls, ["performAction", "reportError"]);
  assert.equal(errors[0], failure);
  assert.ok(!calls.includes("beginExitAnimation"));
  assert.ok(!calls.includes("finalize"));
});

test("successful action removes the row in the right order: API → animation → finalize", async () => {
  const { calls, deps } = trackingDeps();

  const removed = await removeRowAfterAction(deps);

  assert.equal(removed, true);
  assert.deepEqual(calls, [
    "performAction",
    "beginExitAnimation",
    "waitForExitAnimation",
    "finalize",
    "endExitAnimation",
  ]);
});

test("exit-animation state is cleared even when finalize throws", async () => {
  const { calls, deps } = trackingDeps({
    finalize: async () => {
      calls.push("finalize");
      throw new Error("refresh failed");
    },
  });

  await assert.rejects(() => removeRowAfterAction(deps), /refresh failed/);
  assert.ok(calls.includes("endExitAnimation"));
});
