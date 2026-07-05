import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFuzzyIdentityConfirmationPrompt,
  isCalendarProposalExecutable,
  requiresFuzzyIdentityGate,
  withIdentityConfirmedProposal,
} from "./calendarAppointmentSafety.js";
import {
  buildCalendarActionProposal,
  shouldDeferCalendarActionForFuzzyGate,
} from "./calendarActionProposal.js";
import { executeNataliePendingProposal } from "../conversation/voice/natalieProposalExecution.js";

test("requiresFuzzyIdentityGate is true only for fuzzy scores below 0.85", () => {
  assert.equal(requiresFuzzyIdentityGate({ resolutionSource: "fuzzy", matchScore: 0.84 }), true);
  assert.equal(requiresFuzzyIdentityGate({ resolutionSource: "fuzzy", matchScore: 0.85 }), false);
  assert.equal(requiresFuzzyIdentityGate({ resolutionSource: "exact", matchScore: 0.5 }), false);
});

test("fuzzy calendar proposal defers client action until identity is confirmed", () => {
  const response = buildCalendarActionProposal({
    action: "cancel_appointment",
    appointment: {
      id: "appt-1",
      startTime: new Date("2026-07-07T12:00:00.000Z"),
      durationMinutes: 60,
      clientName: "יוסי ביטון",
    },
    nameResolution: {
      clientId: "client-1",
      clientName: "יוסי ביטון",
      spokenName: "רוסי ביטון",
      matchedName: "יוסי ביטון",
      matchScore: 0.8,
      resolutionSource: "fuzzy",
      needsConfirmation: true,
    },
    timeZone: "Asia/Jerusalem",
    when: "יום שלישי, 15:00",
    defaultAnswer: "לבטל?",
  });

  assert.equal("action" in response && response.action, "cancel_appointment");
  assert.match(response.answer ?? "", /^התכוונת ל-יוסי ביטון בתאריך .+ בשעה .+\?$/);
  assert.equal(
    shouldDeferCalendarActionForFuzzyGate(
      "proposal" in response ? (response.proposal as Record<string, unknown>) : null
    ),
    true
  );
});

test("executeNataliePendingProposal blocks fuzzy proposal before identity confirmation", async () => {
  const result = await executeNataliePendingProposal({
    organizationId: "org",
    userId: "user",
    action: "cancel_appointment",
    proposal: {
      appointmentId: "appt-1",
      clientName: "יוסי ביטון",
      appointmentResolution: {
        source: "fuzzy",
        matchScore: 0.8,
        spokenName: "רוסי ביטון",
        matchedName: "יוסי ביטון",
        fuzzyIdentityConfirmationPending: true,
        identityConfirmed: false,
      },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /אישור זהות/);
});

test("withIdentityConfirmedProposal allows execution gate to pass", () => {
  const proposal = {
    appointmentId: "appt-1",
    appointmentResolution: {
      source: "fuzzy",
      matchScore: 0.8,
      spokenName: "רוסי ביטון",
      matchedName: "יוסי ביטון",
      fuzzyIdentityConfirmationPending: true,
      identityConfirmed: false,
    },
  };
  assert.equal(isCalendarProposalExecutable(proposal), false);
  const confirmed = withIdentityConfirmedProposal(proposal);
  assert.equal(isCalendarProposalExecutable(confirmed), true);
});

test("buildFuzzyIdentityConfirmationPrompt uses Hebrew date and time labels", () => {
  const prompt = buildFuzzyIdentityConfirmationPrompt(
    "יוסי ביטון",
    new Date("2026-07-07T12:00:00.000Z"),
    "Asia/Jerusalem"
  );
  assert.match(prompt, /^התכוונת ל-יוסי ביטון בתאריך .+ בשעה \d{2}:\d{2}\?$/);
});
