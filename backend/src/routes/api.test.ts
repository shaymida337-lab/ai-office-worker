import test from "node:test";
import assert from "node:assert/strict";
import { debugTopPaymentAmountsWhere } from "./api.js";

test("debug top-amounts excludes needs_review supplier payments", () => {
  const where = debugTopPaymentAmountsWhere("org-1");

  assert.equal(where.approvalStatus, "approved");
});

test("debug top-amounts still includes approved supplier payments", () => {
  assert.deepEqual(debugTopPaymentAmountsWhere("org-1"), {
    organizationId: "org-1",
    approvalStatus: "approved",
    paid: false,
    paymentRequired: true,
    amount: { gte: 0, lte: 1_000_000 },
  });
});
