import test from "node:test";
import assert from "node:assert/strict";

import { askNatalieBusinessQuestion, isLikelyConversationalQuestion } from "./natalie.js";
import { processNatalieTurn } from "./conversation/conversationRuntime.js";
import { prisma } from "../lib/prisma.js";
import { computeAppointmentNameSimilarity } from "./scheduling/calendarAppointmentResolver.js";

const ORG = "org-natalie-smoke";

function installSmokeMocks() {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalClientFindMany = prisma.client.findMany.bind(prisma.client);
  const originalAppointmentFindMany = prisma.appointment.findMany.bind(prisma.appointment);
  const originalCalendarEventFindMany = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.organization.findUnique = (async () => ({
    timezone: "Asia/Jerusalem",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-smoke",
      organizationId: ORG,
      clientId: "client-smoke",
      serviceId: null,
      startTime: new Date("2026-07-07T12:00:00.000Z"),
      durationMinutes: 60,
      status: "confirmed",
      source: "natalie",
      notes: null,
      googleEventId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      client: { id: "client-smoke", name: "יוסי ביטון" },
      service: null,
    },
  ]) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;

  return () => {
    prisma.organization.findUnique = originalOrg;
    prisma.client.findMany = originalClientFindMany;
    prisma.appointment.findMany = originalAppointmentFindMany;
    prisma.calendarEvent.findMany = originalCalendarEventFindMany;
  };
}

test("production smoke: simple conversational question", async () => {
  assert.equal(isLikelyConversationalQuestion("שלום נטלי"), true);
  const result = await askNatalieBusinessQuestion({
    organizationId: ORG,
    question: "שלום נטלי",
  });
  assert.match("answer" in result ? result.answer : "", /שלום/);
});

test("production smoke: fuzzy wrong name asks clarification not direct action", async () => {
  const spokenName = "רוסי פיטון";
  assert.ok(computeAppointmentNameSimilarity(spokenName, "יוסי ביטון") < 0.85);
  const restore = installSmokeMocks();
  try {
    const result = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: "user-smoke",
        channel: "web_chat",
        modality: "text",
        message: `תעביר את ${spokenName} ליום חמישי בשעה שלוש`,
        role: "owner",
      },
      {
        resolveSession: async () => ({
          id: "session-smoke",
          organizationId: ORG,
          userId: "user-smoke",
          currentChannel: "web_chat",
          structuredHistory: [],
          pendingAction: null,
          pendingConfirmation: null,
          interruptionState: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        }),
        saveSession: async (session) => session,
      }
    );
    assert.equal("action" in result, false);
    assert.match(result.spokenResponse, /^התכוונת ל-יוסי ביטון בתאריך .+ בשעה .+\?$/);
    assert.ok(result.confirmation.required);
  } finally {
    restore();
  }
});
