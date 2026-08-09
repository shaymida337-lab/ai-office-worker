/**
 * Chat-window routing for NatalieAssistantWidget:
 * POST /api/natalie/ask → processNatalieTurn → askNatalieBusinessQuestion
 *
 * Asserts selectedHandler only — does not reimplement Calendar Read / CRM engines.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { askNatalieBusinessQuestion } from "./natalie.js";
import { processNatalieTurn } from "./conversation/conversationRuntime.js";
import { NATALIE_CHAT_ENDPOINT } from "./conversation/natalieAskRouting.js";
import { parseCalendarIntent } from "./calendar/calendarIntentParser.js";
import { calendarReadQueryFromIntent } from "./calendar/calendarReadEngine.js";

const ORG = "org-chat-routing";
const USER = "user-chat-routing";
const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-07-14T07:00:00.000Z");

const CLIENT_SARIT = {
  id: "c-sarit",
  name: "שרית",
  email: null as string | null,
  whatsappNumber: null as string | null,
  emailIsPlaceholder: true,
  isActive: true,
  organizationId: ORG,
  phone: "0501111111" as string | null,
  address: null as string | null,
};

function installChatRoutingPrismaStub() {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    serviceFindFirst: prisma.service.findFirst.bind(prisma.service),
    integrationFindUnique: prisma.integration.findUnique.bind(prisma.integration),
    clientFindMany: prisma.client.findMany.bind(prisma.client),
    clientFindFirst: prisma.client.findFirst.bind(prisma.client),
    projectionFindMany: prisma.appointmentAttendanceProjection.findMany.bind(
      prisma.appointmentAttendanceProjection
    ),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: TZ,
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;

  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  prisma.service.findFirst = (async () => null) as typeof prisma.service.findFirst;
  prisma.integration.findUnique = (async () => null) as typeof prisma.integration.findUnique;
  prisma.appointmentAttendanceProjection.findMany = (async () =>
    []) as typeof prisma.appointmentAttendanceProjection.findMany;

  // Claude-fallback path loads dashboard snapshot — stub reads so local DB schema drift can't break routing tests.
  const zeroCount = (async () => 0) as typeof prisma.supplierPayment.count;
  const emptyAgg = (async () => ({ _sum: { amount: null }, _count: 0, _avg: {}, _min: {}, _max: {} })) as typeof prisma.supplierPayment.aggregate;
  prisma.supplierPayment.count = zeroCount;
  prisma.supplierPayment.aggregate = emptyAgg;
  prisma.customerInvoice.count = zeroCount as typeof prisma.customerInvoice.count;
  prisma.customerInvoice.aggregate = emptyAgg as typeof prisma.customerInvoice.aggregate;
  prisma.task.count = zeroCount as typeof prisma.task.count;
  prisma.appointment.count = zeroCount as typeof prisma.appointment.count;
  prisma.client.count = zeroCount as typeof prisma.client.count;
  prisma.lead.count = zeroCount as typeof prisma.lead.count;
  prisma.emailMessage.count = zeroCount as typeof prisma.emailMessage.count;
  prisma.invoice.count = zeroCount as typeof prisma.invoice.count;
  prisma.syncLog.count = zeroCount as typeof prisma.syncLog.count;
  prisma.emailAttachment.count = zeroCount as typeof prisma.emailAttachment.count;
  prisma.alert.count = zeroCount as typeof prisma.alert.count;

  prisma.client.findMany = (async (args) => {
    const where = args?.where as {
      organizationId?: string;
      name?: { contains?: string; mode?: string } | string;
      isActive?: boolean;
    };
    if (where?.organizationId && where.organizationId !== ORG) return [];
    let rows = [CLIENT_SARIT];
    const nameFilter = where?.name;
    if (nameFilter && typeof nameFilter === "object" && typeof nameFilter.contains === "string") {
      const needle = nameFilter.contains.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(needle));
    }
    return rows;
  }) as typeof prisma.client.findMany;

  prisma.client.findFirst = (async (args) => {
    const where = args?.where as { id?: string; organizationId?: string };
    if (where?.organizationId && where.organizationId !== ORG) return null;
    if (where?.id && where.id !== CLIENT_SARIT.id) return null;
    return CLIENT_SARIT;
  }) as typeof prisma.client.findFirst;

  return () => {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.service.findFirst = originals.serviceFindFirst;
    prisma.integration.findUnique = originals.integrationFindUnique;
    prisma.client.findMany = originals.clientFindMany;
    prisma.client.findFirst = originals.clientFindFirst;
    prisma.appointmentAttendanceProjection.findMany = originals.projectionFindMany;
  };
}

const brainDeps = {
  now: NOW,
  loadTimezone: async () => TZ,
  askClaude: async () => ({ answer: "claude-fallback-ok" }),
};

function memorySessionStore() {
  const sessions = new Map<string, unknown>();
  return {
    async resolveSession(input: {
      sessionId?: string | null;
      organizationId: string;
      userId: string;
      channel: string;
    }) {
      const id = input.sessionId?.trim() || `sess-${sessions.size + 1}`;
      const existing = sessions.get(id);
      if (existing) return existing as never;
      const created = {
        id,
        organizationId: input.organizationId,
        userId: input.userId,
        currentChannel: input.channel,
        structuredHistory: [] as unknown[],
        pendingAction: null,
        pendingConfirmation: null,
        interruptionState: null,
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      sessions.set(id, created);
      return created as never;
    },
    async saveSession(session: { id: string }) {
      sessions.set(session.id, session);
      return session as never;
    },
  };
}

/** Same call chain as POST /api/natalie/ask after auth. */
async function askViaChatEndpoint(question: string) {
  const store = memorySessionStore();
  return processNatalieTurn(
    {
      organizationId: ORG,
      userId: USER,
      channel: "web_chat",
      modality: "text",
      message: question,
      sessionId: null,
      role: "owner",
    },
    {
      resolveSession: store.resolveSession,
      saveSession: store.saveSession,
      ask: (input) => askNatalieBusinessQuestion(input, brainDeps),
    }
  );
}

test("parser wiring: מתי התור של שרית → existing calendar read query", () => {
  const intent = parseCalendarIntent("מתי התור של שרית?", { now: NOW });
  assert.equal(intent.intent, "list_appointments");
  assert.equal(intent.customerName, "שרית");
  assert.ok(calendarReadQueryFromIntent(intent));
});

test("parser wiring: מה הלקוח הבא שלי → next client read query", () => {
  const intent = parseCalendarIntent("מה הלקוח הבא שלי?", { now: NOW });
  assert.equal(intent.intent, "list_appointments");
  assert.equal(intent.readMode, "next");
  assert.equal(intent.nextFocus, "client");
  assert.ok(calendarReadQueryFromIntent(intent));
});

test("chat endpoint: מה הלקוח הבא שלי? → calendar_read (no fallback)", async () => {
  const restore = installChatRoutingPrismaStub();
  try {
    const result = await askViaChatEndpoint("מה הלקוח הבא שלי?");
    assert.equal(result.routing?.endpoint, NATALIE_CHAT_ENDPOINT);
    assert.equal(result.routing?.selectedHandler, "calendar_read");
    assert.equal(result.routing?.fallbackUsed, false);
  } finally {
    restore();
  }
});

test("chat endpoint: מי הלקוח הבא שלי? → sanitized answer in final ask payload", async () => {
  const restore = installChatRoutingPrismaStub();
  try {
    const result = await askViaChatEndpoint("מי הלקוח הבא שלי?");
    assert.equal(result.routing?.selectedHandler, "calendar_read");
    assert.match(result.answer, /אין לך פגישות|לא הצלחתי לבדוק את היומן|ייתכן שיש פגישות/u);
    assert.doesNotMatch(result.answer, /Google Calendar|מקור נתונים|תמונה מלאה|אומת בהצלחה/i);
  } finally {
    restore();
  }
});

test("chat endpoint: מתי התור של שרית? → calendar_read (no fallback)", async () => {
  const restore = installChatRoutingPrismaStub();
  try {
    const result = await askViaChatEndpoint("מתי התור של שרית?");
    assert.equal(result.routing?.selectedHandler, "calendar_read");
    assert.equal(result.routing?.fallbackUsed, false);
  } finally {
    restore();
  }
});

test("chat endpoint: מי לא אישר הגעה? → calendar_read (unchanged)", async () => {
  const restore = installChatRoutingPrismaStub();
  try {
    const result = await askViaChatEndpoint("מי לא אישר הגעה?");
    assert.equal(result.routing?.selectedHandler, "calendar_read");
    assert.equal(result.routing?.fallbackUsed, false);
  } finally {
    restore();
  }
});

test("chat endpoint: תפתחי את הכרטיס של שרית → crm open_client with navigable path", async () => {
  const restore = installChatRoutingPrismaStub();
  try {
    const result = await askViaChatEndpoint("תפתחי את הכרטיס של שרית");
    assert.equal(result.routing?.selectedHandler, "crm");
    assert.equal(result.routing?.fallbackUsed, false);
    assert.equal("action" in result ? result.action : null, "open_client");
    if ("action" in result && result.action === "open_client") {
      assert.equal(result.proposal.path, `/dashboard/clients/${CLIENT_SARIT.id}`);
      assert.equal(result.proposal.clientId, CLIENT_SARIT.id);
    }
  } finally {
    restore();
  }
});

test("chat endpoint: מתי אני פנוי מחר? → calendar_read", async () => {
  const restore = installChatRoutingPrismaStub();
  try {
    const result = await askViaChatEndpoint("מתי אני פנוי מחר?");
    assert.equal(result.routing?.selectedHandler, "calendar_read");
    assert.equal(result.routing?.fallbackUsed, false);
  } finally {
    restore();
  }
});

test("chat endpoint: general non-calendar/crm → claude_fallback", async () => {
  const restore = installChatRoutingPrismaStub();
  try {
    // Avoid accidental conversational/memory hits; force a neutral biz question.
    const result = await askViaChatEndpoint("מה אחוז המע\"מ בישראל לפי החוק?");
    assert.equal(result.routing?.selectedHandler, "claude_fallback");
    assert.equal(result.routing?.fallbackUsed, true);
    assert.match(result.answer, /claude-fallback-ok/);
  } finally {
    restore();
  }
});
