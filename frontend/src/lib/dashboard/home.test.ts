import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHeroHumanMessage,
  FIRST_VISIT_WELCOME_CONNECTED,
  FIRST_VISIT_WELCOME_DISCONNECTED,
  formatFirstScanEmptyMessage,
} from "./home.js";

test("buildHeroHumanMessage uses first-visit welcome copy", () => {
  assert.equal(
    buildHeroHumanMessage({ firstVisit: true, gmailConnected: true }),
    FIRST_VISIT_WELCOME_CONNECTED
  );
  assert.equal(
    buildHeroHumanMessage({ firstVisit: true, gmailConnected: false }),
    FIRST_VISIT_WELCOME_DISCONNECTED
  );
});

test("formatFirstScanEmptyMessage explains zero results", () => {
  const message = formatFirstScanEmptyMessage(12);
  assert.match(message, /12 מיילים/);
  assert.match(message, /לא מצאתי חשבוניות/);
});
