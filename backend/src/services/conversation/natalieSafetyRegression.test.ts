import test from "node:test";
import assert from "node:assert/strict";

import { evaluateConfirmationPolicy } from "./conversationConfirmationPolicy.js";
import { evaluateNatalieSafety, hebrewSafetyFallback } from "./natalieSafetyEvaluation.js";
import { evaluateZeroWrongAction } from "./conversationZeroWrongAction.js";
import { isCalendarProposalExecutable } from "../scheduling/calendarAppointmentSafety.js";
import { executeNataliePendingProposal } from "./voice/natalieProposalExecution.js";

test("null role denies destructive calendar actions", () => {
  const policy = evaluateConfirmationPolicy({
    action: "cancel_appointment",
    channel: "web_chat",
    role: null,
  });
  assert.equal(policy.allowed, false);
});

test("evaluateNatalieSafety blocks fuzzy calendar execution before identity confirmation", () => {
  const proposal = {
    appointmentId: "appt-1",
    clientName: "יוסי ביטון",
    appointmentResolution: {
      source: "fuzzy",
      matchScore: 0.8,
      spokenName: "רוסי פיטון",
      matchedName: "יוסי ביטון",
      fuzzyIdentityConfirmationPending: true,
      identityConfirmed: false,
    },
  };
  const safety = evaluateNatalieSafety({
    action: "reschedule_appointment",
    proposal,
    intentText: "תעביר את רוסי פיטון",
    channel: "web_chat",
    role: "owner",
  });
  assert.equal(safety.confirmationRequired, true);
  assert.equal(safety.identityCertainty, "fuzzy");
  assert.equal(safety.executionReady, false);
  assert.equal(isCalendarProposalExecutable(proposal), false);
});

test("missing task title returns Hebrew follow-up", () => {
  const confirmation = evaluateConfirmationPolicy({
    action: "create_task",
    channel: "web_chat",
    role: "owner",
  });
  const zeroWrong = evaluateZeroWrongAction({
    action: "create_task",
    proposal: { title: "" },
    confirmation,
    intentText: "צור משימה",
  });
  assert.equal(zeroWrong.ready, false);
  assert.match(zeroWrong.followUpQuestion ?? "", /כותרת/);
});

test("malformed invoice proposal is blocked", () => {
  const confirmation = evaluateConfirmationPolicy({
    action: "issue_invoice",
    channel: "web_chat",
    role: "owner",
  });
  const zeroWrong = evaluateZeroWrongAction({
    action: "issue_invoice",
    proposal: { customerName: "לקוח" },
    confirmation,
    intentText: "הוצא חשבונית",
  });
  assert.equal(zeroWrong.ready, false);
  assert.ok(zeroWrong.violations.includes("invoice_fields_missing"));
});

test("executeNataliePendingProposal blocks fuzzy calendar without identity confirmation", async () => {
  const result = await executeNataliePendingProposal({
    organizationId: "org",
    userId: "user",
    action: "cancel_appointment",
    proposal: {
      appointmentId: "appt-1",
      appointmentResolution: {
        source: "fuzzy",
        matchScore: 0.72,
        spokenName: "רוסי פיטון",
        matchedName: "יוסי ביטון",
        fuzzyIdentityConfirmationPending: true,
        identityConfirmed: false,
      },
    },
  });
  assert.equal(result.ok, false);
});

test("hebrewSafetyFallback covers permission and confirmation gaps", () => {
  assert.match(hebrewSafetyFallback(["missing_permission:calendar.cancel"]), /אין לי הרשאה/);
  assert.match(hebrewSafetyFallback(["confirmation_missing"]), /אין לי פעולה/);
});
