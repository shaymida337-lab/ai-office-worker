import test from "node:test";
import assert from "node:assert/strict";
import { rankPrimaryActions, resolvePrimaryAction } from "./primaryAction.js";

test("natalie primary action: document reviews win on today screen", () => {
  const action = resolvePrimaryAction({
    screen: "today",
    documentReviewCount: 2,
    unpaidPaymentCount: 5,
  });

  assert.match(action.label, /אשר 2 מסמכים/);
  assert.equal(action.intent, "approve_documents");
});

test("natalie primary action: only one primary emphasis", () => {
  const ranked = rankPrimaryActions({
    screen: "payments",
    documentReviewCount: 1,
    unpaidPaymentCount: 4,
    missingInvoiceCount: 2,
  });

  const top = ranked.sort((a, b) => b.priority - a.priority)[0];
  assert.equal(top?.intent, "approve_documents");
});

test("natalie primary action: scan running disables action", () => {
  const action = resolvePrimaryAction({
    screen: "today",
    scanRunning: true,
    documentReviewCount: 3,
  });

  assert.equal(action.disabled, true);
  assert.match(action.reason ?? "", /בודקת/);
});

test("natalie primary action: screen defaults", () => {
  assert.equal(resolvePrimaryAction({ screen: "calendar" }).label, "אשר פגישה");
  assert.equal(resolvePrimaryAction({ screen: "payments" }).label, "אשר תשלומים");
});

test("natalie primary action: engine ON links to decision queue", () => {
  const action = resolvePrimaryAction({
    screen: "today",
    pendingSchedulingDecisionCount: 1,
    primarySchedulingDecisionHref: "/dashboard/calendar?decisionId=dec-1",
  });

  assert.match(action.label, /החלטת יומן/);
  assert.equal(action.href, "/dashboard/calendar?decisionId=dec-1");
  assert.equal(action.intent, "confirm_scheduling_decision");
});
