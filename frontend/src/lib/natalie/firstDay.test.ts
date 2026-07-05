import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeFirstDashboardVisit,
  getFirstNameForGreeting,
  markFirstDashboardVisit,
  FIRST_DASHBOARD_VISIT_KEY,
  ONBOARDING_PROGRESS_KEY,
  isActiveOnboardingStep,
  resolveOnboardingHydration,
  type OnboardingProgress,
} from "./firstDay.js";

const baseProgress: OnboardingProgress = {
  step: 1,
  businessName: "Biz",
  firstName: "Test",
  businessType: "service_business",
  businessSize: "solo",
  helpAreas: ["documents"],
};

test("getFirstNameForGreeting prefers current organization name over stale localStorage", () => {
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;
  // @ts-expect-error test shim
  globalThis.window = {
    localStorage: {
      setItem: (key: string, value: string) => storage.set(key, value),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    },
  };

  try {
    storage.set(
      ONBOARDING_PROGRESS_KEY,
      JSON.stringify({ ...baseProgress, firstName: "שרון" })
    );
    assert.equal(getFirstNameForGreeting("שי"), "שי");
  } finally {
    globalThis.window = originalWindow;
  }
});

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

test("resolveOnboardingHydration redirects stale step 6 to dashboard", () => {
  assert.deepEqual(resolveOnboardingHydration({ ...baseProgress, step: 6 }), { action: "redirect_dashboard" });
});

test("resolveOnboardingHydration resets invalid saved steps", () => {
  assert.deepEqual(resolveOnboardingHydration({ ...baseProgress, step: 99 as OnboardingProgress["step"] }), {
    action: "reset_step_1",
  });
  assert.equal(isActiveOnboardingStep(99), false);
});

test("resolveOnboardingHydration applies normal steps 1 and 5", () => {
  assert.deepEqual(resolveOnboardingHydration({ ...baseProgress, step: 1 }), {
    action: "apply",
    progress: { ...baseProgress, step: 1 },
  });
  assert.deepEqual(resolveOnboardingHydration({ ...baseProgress, step: 5 }), {
    action: "apply",
    progress: { ...baseProgress, step: 5 },
  });
  assert.equal(resolveOnboardingHydration(null).action, "none");
});

test("resolveOnboardingHydration normalizes missing helpAreas", () => {
  const saved = { ...baseProgress, step: 3 as const, helpAreas: undefined as unknown as OnboardingProgress["helpAreas"] };
  const result = resolveOnboardingHydration(saved);
  assert.equal(result.action, "apply");
  if (result.action === "apply") {
    assert.deepEqual(result.progress.helpAreas, []);
  }
});
