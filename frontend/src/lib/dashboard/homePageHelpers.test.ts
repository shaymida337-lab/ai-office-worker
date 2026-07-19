import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackComponent,
  resolvePersonalDisplayName,
  resolveWorkspaceDisplayName,
  systemReasonLabel,
} from "./homePageHelpers.js";

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

test("resolveWorkspaceDisplayName prefers businessName over name", () => {
  assert.equal(resolveWorkspaceDisplayName({ businessName: "קדמה שרון", name: "שי" }), "קדמה שרון");
  assert.equal(resolveWorkspaceDisplayName({ businessName: null, name: "שי" }), "שי");
  assert.equal(resolveWorkspaceDisplayName(null), "העסק שלי");
});

test("resolvePersonalDisplayName uses settings.name and never businessName", () => {
  assert.equal(resolvePersonalDisplayName({ name: "שי מידה" }), "שי");
  assert.equal(resolvePersonalDisplayName({ name: "שי" }), "שי");
  assert.equal(resolvePersonalDisplayName({ name: "" }), null);
  assert.equal(resolvePersonalDisplayName(null), null);
  assert.notEqual(
    resolvePersonalDisplayName({ name: "שי" }),
    resolveWorkspaceDisplayName({ businessName: "קדמה", name: "שי" })
  );
});
