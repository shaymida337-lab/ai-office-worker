import assert from "node:assert/strict";
import test from "node:test";
import { fallbackComponent, systemReasonLabel } from "./homePageHelpers.js";

test("fallback disconnected component does not imply live check passed", () => {
  const component = fallbackComponent("drive", "גוגל דרייב", false);
  assert.equal(component.connected, false);
  assert.equal(component.reason, "disconnected");
  assert.equal(systemReasonLabel(component.reason), "לא מחובר");
});

test("fallback connected component has no failing reason", () => {
  const component = fallbackComponent("gmail", "ג׳ימייל", true);
  assert.equal(component.connected, true);
  assert.equal(component.reason, null);
  assert.equal(systemReasonLabel(component.reason), null);
});
