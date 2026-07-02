import assert from "node:assert/strict";
import test from "node:test";
import { buildAlreadyWorkedSummary } from "./alreadyWorked";

test("buildAlreadyWorkedSummary encourages Gmail connect when disconnected", () => {
  const summary = buildAlreadyWorkedSummary({ gmailConnected: false });
  assert.match(summary.emptyMessage, /חבר את Gmail/);
  assert.equal(summary.items.length, 0);
});

test("buildAlreadyWorkedSummary lists premium work lines", () => {
  const summary = buildAlreadyWorkedSummary({
    gmailConnected: true,
    emailsScanned: 26,
    invoicesFound: 5,
    paymentsUpdated: 2,
    appointmentsSet: 1,
    tasksCreated: 3,
  });
  assert.match(summary.items[0]?.text ?? "", /26 מיילים/);
  assert.match(summary.items.some((item) => item.text.includes("5 חשבוניות")) ? "yes" : "", /yes/);
});
