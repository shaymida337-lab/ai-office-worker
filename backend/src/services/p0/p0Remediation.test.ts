import test from "node:test";
import assert from "node:assert/strict";

import {
  CROSS_ORG_QUARANTINE_MARKER,
  appendQuarantineMarker,
  hasQuarantineMarker,
  isQuarantinedGmailScanItem,
  isQuarantinedSupplierPayment,
} from "./crossOrgGmailQuarantine.js";
import { isAllowlistedGmailMessageId, SHARON_CONFIRMED_ALLOWLIST } from "./sharonContaminationAllowlist.js";
import { detectCrossOrgGmailMessageIdViolations } from "../scanner/scannerIsolationChecks.js";
import {
  ZERO_AMOUNT_DATA_QUALITY_MARKER,
  assertNewSupplierPaymentQuality,
  isPayableSupplierPayment,
  isPositivePaymentAmount,
} from "./supplierPaymentQuality.js";

test("sharon allowlist contains five user-confirmed gmail ids", () => {
  assert.equal(SHARON_CONFIRMED_ALLOWLIST.gmailMessageIds.length, 5);
  assert.equal(isAllowlistedGmailMessageId("19eac05f383d017b"), true);
  assert.equal(isAllowlistedGmailMessageId("not-a-real-id"), false);
});

test("detectCrossOrgGmailMessageIdViolations flags shared gmail ids", () => {
  const violations = detectCrossOrgGmailMessageIdViolations(
    SHARON_CONFIRMED_ALLOWLIST.organizationId,
    [{ id: "em-1", gmailId: "gmail-1", receivedAt: new Date() }],
    [{ id: "em-other", organizationId: "org-other", gmailId: "gmail-1" }],
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.violationType, "cross_org_gmail_message_id");
});

test("quarantine marker detection on gsi and payments", () => {
  assert.equal(hasQuarantineMarker(CROSS_ORG_QUARANTINE_MARKER), true);
  assert.equal(
    isQuarantinedGmailScanItem({ reviewStatus: "rejected", decisionReason: CROSS_ORG_QUARANTINE_MARKER }),
    true,
  );
  assert.equal(
    isQuarantinedSupplierPayment({ duplicateReason: appendQuarantineMarker(null, CROSS_ORG_QUARANTINE_MARKER) }),
    true,
  );
});

test("assertNewSupplierPaymentQuality rejects zero amount and missing fingerprint", () => {
  assert.throws(() => assertNewSupplierPaymentQuality({ amount: 0, documentFingerprint: "fp-1" }));
  assert.throws(() => assertNewSupplierPaymentQuality({ amount: 100, documentFingerprint: null }));
  assert.doesNotThrow(() => assertNewSupplierPaymentQuality({ amount: 100, documentFingerprint: "fp-1" }));
});

test("isPayableSupplierPayment excludes zero and quarantined rows", () => {
  assert.equal(isPositivePaymentAmount(0), false);
  assert.equal(
    isPayableSupplierPayment({
      approvalStatus: "approved",
      amount: 0,
      duplicateReason: null,
      paid: false,
    }),
    false,
  );
  assert.equal(
    isPayableSupplierPayment({
      approvalStatus: "approved",
      amount: 100,
      duplicateReason: ZERO_AMOUNT_DATA_QUALITY_MARKER,
      paid: false,
    }),
    false,
  );
  assert.equal(
    isPayableSupplierPayment({
      approvalStatus: "approved",
      amount: 250,
      duplicateReason: null,
      paid: false,
    }),
    true,
  );
});
