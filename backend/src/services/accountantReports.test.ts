import test from "node:test";
import assert from "node:assert/strict";
import { accountantApprovedExpenseWhere, sumApprovedSupplierExpenses } from "./accountantReports.js";

test("accountant expense total excludes needs_review supplier payments", () => {
  const total = sumApprovedSupplierExpenses([
    { amount: 100, approvalStatus: "needs_review" },
    { amount: 250, approvalStatus: "approved" },
  ]);

  assert.equal(total, 250);
});

test("accountant expense query filters supplier payments by approved status", () => {
  const start = new Date("2026-06-01T00:00:00.000Z");
  const end = new Date("2026-06-30T23:59:59.999Z");

  assert.deepEqual(accountantApprovedExpenseWhere("org-1", start, end), {
    organizationId: "org-1",
    approvalStatus: "approved",
    date: { gte: start, lte: end },
  });
});
