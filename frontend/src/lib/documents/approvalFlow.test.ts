import test from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_FAILURE_MESSAGE,
  APPROVAL_SUCCESS_MESSAGE,
  isConfirmedApprovalResponse,
  shouldRemoveReviewAfterApproval,
} from "./approvalFlow.js";

test("isConfirmedApprovalResponse accepts success with supplierPaymentId", () => {
  assert.equal(
    isConfirmedApprovalResponse({
      success: true,
      supplierPaymentId: "payment-1",
      status: "approved",
    }),
    true,
  );
});

test("isConfirmedApprovalResponse rejects missing payment id", () => {
  assert.equal(isConfirmedApprovalResponse({ success: true, ok: true }), false);
});

test("isConfirmedApprovalResponse rejects explicit failure", () => {
  assert.equal(
    isConfirmedApprovalResponse({ success: false, supplierPaymentId: "payment-1" }),
    false,
  );
});

test("shouldRemoveReviewAfterApproval mirrors confirmed response guard", () => {
  assert.equal(shouldRemoveReviewAfterApproval({ ok: true, paymentId: "payment-9" }), true);
  assert.equal(shouldRemoveReviewAfterApproval({ ok: true }), false);
});

test("approval messages are stable Hebrew copy", () => {
  assert.match(APPROVAL_SUCCESS_MESSAGE, /אושר/);
  assert.equal(APPROVAL_FAILURE_MESSAGE, "האישור נכשל — המסמך נשאר לבדיקה ולא נמחק");
});
