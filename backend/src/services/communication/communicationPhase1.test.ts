import test from "node:test";
import assert from "node:assert/strict";
import { CommunicationService } from "./communicationService.js";
import type { CommunicationEventRecord } from "./types.js";
import {
  recordGmailCommunication,
  recordInboundWhatsAppCommunication,
  recordVoiceCommunication,
  recordWebChatCommunication,
} from "./recordCommunicationTrace.js";

function createTestCommunicationService() {
  const events = new Map<string, CommunicationEventRecord>();

  function mapKey(organizationId: string, channel: string, externalMessageId: string) {
    return `${organizationId}:${channel}:${externalMessageId}`;
  }

  const service = new CommunicationService({
    communicationEvent: {
      async findMany(args: { where?: Record<string, unknown>; skip?: number; take?: number }) {
        let rows = [...events.values()];
        const where = args.where ?? {};
        if (where.organizationId) rows = rows.filter((row) => row.organizationId === where.organizationId);
        if (where.channel) rows = rows.filter((row) => row.channel === where.channel);
        if (where.externalMessageId) rows = rows.filter((row) => row.externalMessageId === where.externalMessageId);
        if (where.correlationId) rows = rows.filter((row) => row.correlationId === where.correlationId);
        if (where.id) rows = rows.filter((row) => row.id === where.id);
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take) rows = rows.slice(0, args.take);
        return rows;
      },
      async count(args: { where?: Record<string, unknown> }) {
        const rows = await this.findMany({ where: args.where });
        return rows.length;
      },
      async upsert(args: {
        where: { organizationId_channel_externalMessageId: { organizationId: string; channel: string; externalMessageId: string } };
        create: Omit<CommunicationEventRecord, "id" | "createdAt" | "updatedAt">;
        update: Partial<CommunicationEventRecord>;
      }) {
        const composite = args.where.organizationId_channel_externalMessageId;
        const key = mapKey(composite.organizationId, composite.channel, composite.externalMessageId);
        const existing = events.get(key);
        const now = new Date();
        if (existing) {
          const updated = { ...existing, ...args.update, updatedAt: now };
          events.set(key, updated);
          return updated;
        }
        const created = {
          id: `ce_${events.size + 1}`,
          createdAt: now,
          updatedAt: now,
          ...args.create,
        } satisfies CommunicationEventRecord;
        events.set(key, created);
        return created;
      },
      async update(args: { where: { id: string }; data: Partial<CommunicationEventRecord> }) {
        const row = [...events.values()].find((item) => item.id === args.where.id);
        if (!row) throw new Error("not found");
        const key = mapKey(row.organizationId, row.channel, row.externalMessageId);
        const updated = { ...row, ...args.data, updatedAt: new Date() };
        events.set(key, updated);
        return updated;
      },
    },
  });

  return { events, service };
}

test("WhatsApp creates CommunicationEvent", async () => {
  const { events, service } = createTestCommunicationService();

  await recordInboundWhatsAppCommunication(
    {
      organizationId: "org-1",
      providerMessageSid: "SM999",
      fromNumber: "whatsapp:+972501111111",
      toNumber: "whatsapp:+14155238886",
      body: "invoice attached",
      whatsappLogId: "log-1",
      correlationId: "SM999",
    },
    { service }
  );

  assert.equal(events.size, 1);
  const event = [...events.values()][0];
  assert.equal(event.channel, "whatsapp");
  assert.equal(event.correlationId, "SM999");
  assert.equal(event.sourceReference, "log-1");
});

test("Gmail creates CommunicationEvent", async () => {
  const { events, service } = createTestCommunicationService();

  await recordGmailCommunication(
    {
      organizationId: "org-1",
      gmailMessageId: "gmail-msg-1",
      emailMessageId: "email-row-1",
      from: "vendor@example.com",
      subject: "Invoice",
      bodyText: "Please pay",
      occurredAt: new Date("2026-07-06T08:00:00Z"),
      correlationId: "gmail-msg-1",
    },
    { service }
  );

  assert.equal(events.size, 1);
  const event = [...events.values()][0];
  assert.equal(event.channel, "gmail");
  assert.equal(event.subject, "Invoice");
});

test("Voice creates CommunicationEvent", async () => {
  const { events, service } = createTestCommunicationService();

  await recordVoiceCommunication(
    {
      organizationId: "org-1",
      userId: "user-1",
      turnId: "turn-voice-1",
      transcript: "מה המצב",
      sessionId: "session-1",
    },
    { service }
  );

  const event = [...events.values()][0];
  assert.equal(event.channel, "web_voice");
  assert.equal(event.externalMessageId, "turn-voice-1");
  assert.equal(event.correlationId, "turn-voice-1");
});

test("Web chat creates CommunicationEvent", async () => {
  const { events, service } = createTestCommunicationService();

  await recordWebChatCommunication(
    {
      organizationId: "org-1",
      userId: "user-1",
      message: "כמה חשבוניות פתוחות",
      sessionId: "session-chat-9",
      correlationId: "session-chat-9",
    },
    { service }
  );

  const event = [...events.values()][0];
  assert.equal(event.channel, "web_chat");
  assert.equal(event.correlationId, "session-chat-9");
});

test("duplicate externalMessageId does not duplicate CommunicationEvent records", async () => {
  const { events, service } = createTestCommunicationService();

  await recordInboundWhatsAppCommunication(
    {
      organizationId: "org-1",
      providerMessageSid: "SM-dup",
      body: "one",
      whatsappLogId: "log-1",
    },
    { service }
  );
  await recordInboundWhatsAppCommunication(
    {
      organizationId: "org-1",
      providerMessageSid: "SM-dup",
      body: "two",
      whatsappLogId: "log-1",
    },
    { service }
  );

  assert.equal(events.size, 1);
  assert.equal([...events.values()][0]?.bodyPreview, "two");
});

test("organization isolation in communication history", async () => {
  const { service } = createTestCommunicationService();

  await recordGmailCommunication(
    {
      organizationId: "org-a",
      gmailMessageId: "g-1",
      emailMessageId: "e-1",
      from: "a@example.com",
      bodyText: "a",
      occurredAt: new Date(),
    },
    { service }
  );
  await recordGmailCommunication(
    {
      organizationId: "org-b",
      gmailMessageId: "g-2",
      emailMessageId: "e-2",
      from: "b@example.com",
      bodyText: "b",
      occurredAt: new Date(),
    },
    { service }
  );

  const orgA = await service.loadCommunicationHistory({ organizationId: "org-a" });
  const orgB = await service.loadCommunicationHistory({ organizationId: "org-b" });
  assert.equal(orgA.total, 1);
  assert.equal(orgB.total, 1);
  assert.notEqual(orgA.items[0]?.id, orgB.items[0]?.id);
});

test("correlation IDs propagate on voice turns", async () => {
  const { service } = createTestCommunicationService();

  await recordVoiceCommunication(
    {
      organizationId: "org-1",
      userId: "user-1",
      turnId: "turn-77",
      transcript: "שלח וואטסאפ לקובי",
      sessionId: "sess-77",
      correlationId: "turn-77",
    },
    { service }
  );

  const history = await service.loadCommunicationHistory({
    organizationId: "org-1",
    correlationId: "turn-77",
  });
  assert.equal(history.total, 1);
  assert.equal(history.items[0]?.correlationId, "turn-77");
});
