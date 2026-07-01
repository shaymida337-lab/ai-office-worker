import test from "node:test";
import assert from "node:assert/strict";

import {
  duplicateSupplierPaymentBlockReason,
  isActiveSupplierPayment,
  pickCanonicalSupplierPayment,
} from "./supplierPaymentSourceDedup.js";

test("isActiveSupplierPayment rejects rejected rows", () => {
  assert.equal(isActiveSupplierPayment({ approvalStatus: "rejected", paid: false }), false);
  assert.equal(isActiveSupplierPayment({ approvalStatus: "approved", paid: false }), true);
  assert.equal(isActiveSupplierPayment({ approvalStatus: "needs_review", paid: false }), true);
});

test("pickCanonicalSupplierPayment keeps oldest row", () => {
  const oldest = { id: "a", createdAt: new Date("2026-01-01T00:00:00Z") };
  const newest = { id: "b", createdAt: new Date("2026-02-01T00:00:00Z") };
  assert.equal(pickCanonicalSupplierPayment([newest, oldest])?.id, "a");
});

test("duplicateSupplierPaymentBlockReason references existing payment id", () => {
  assert.match(
    duplicateSupplierPaymentBlockReason({ id: "pay_123", emailMessageId: "em_1", documentFingerprint: "fp" }),
    /pay_123/
  );
});
