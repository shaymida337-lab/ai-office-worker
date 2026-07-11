import test from "node:test";
import assert from "node:assert/strict";
import { resolvePrimaryAction } from "./primaryAction.js";

test("invoices screen default routes to completion queue", () => {
  const action = resolvePrimaryAction({ screen: "invoices" });
  assert.equal(action.href, "/reports");
  assert.match(action.label, /השלימי חשבוניות/);
});

test("missing invoice count prioritizes completion queue", () => {
  const action = resolvePrimaryAction({ screen: "today", missingInvoiceCount: 3 });
  assert.equal(action.href, "/reports");
  assert.match(action.label, /השלימי חשבוניות/);
});
