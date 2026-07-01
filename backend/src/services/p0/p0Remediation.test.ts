import test from "node:test";
import assert from "node:assert/strict";

import { isAllowlistedGmailMessageId, SHARON_CONFIRMED_ALLOWLIST } from "../p0/sharonContaminationAllowlist.js";
import { detectCrossOrgGmailMessageIdViolations } from "../scanner/scannerIsolationChecks.js";

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
