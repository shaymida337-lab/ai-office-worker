import test from "node:test";
import assert from "node:assert/strict";
import { createInboundWhatsAppLogOnce, resolveOwnerAssistantWhatsAppReply } from "./webhooks.js";
import { classifyJunk, shouldAutoClassifyAfterJunkFilter } from "../services/classification/junkFilter.js";

function createFakeWhatsAppLogStore() {
  const logs: Array<{ id: string } & Record<string, any>> = [];
  return {
    logs,
    store: {
      whatsAppLog: {
        async findFirst(args: any) {
          const where = args.where;
          return logs.find((log) =>
            log.organizationId === where.organizationId &&
            log.direction === where.direction &&
            log.providerMessageSid === where.providerMessageSid
          ) ?? null;
        },
        async create(args: any) {
          const created = { id: `log-${logs.length + 1}`, ...args.data };
          logs.push(created);
          return { id: created.id };
        },
      },
    },
  };
}

test("WhatsApp webhook idempotency processes same providerMessageSid once", async () => {
  const fake = createFakeWhatsAppLogStore();
  const input = {
    organizationId: "org-1",
    body: "hello",
    fromNumber: "972501111111",
    toNumber: "14155238886",
    providerMessageSid: "SM123",
    mediaCount: 0,
    mediaJson: [],
  };

  const first = await createInboundWhatsAppLogOnce(input, fake.store);
  const second = await createInboundWhatsAppLogOnce(input, fake.store);

  assert.equal(first.created, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.created, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.id, first.id);
  assert.equal(fake.logs.length, 1);
});

test("WhatsApp webhook idempotency handles unique constraint race", async () => {
  const fake = createFakeWhatsAppLogStore();
  const input = {
    organizationId: "org-1",
    body: "hello",
    fromNumber: "972501111111",
    toNumber: "14155238886",
    providerMessageSid: "SM-RACE",
    mediaCount: 0,
    mediaJson: [],
  };

  const originalCreate = fake.store.whatsAppLog.create;
  let createCalls = 0;
  fake.store.whatsAppLog.create = async (args: any) => {
    createCalls += 1;
    if (createCalls === 1) {
      const created = { id: "log-race-1", ...args.data };
      fake.logs.push(created);
      const err = new Error("Unique constraint failed") as Error & { code: string };
      err.code = "P2002";
      throw err;
    }
    return originalCreate(args);
  };

  const result = await createInboundWhatsAppLogOnce(input, fake.store);
  assert.equal(result.duplicate, true);
  assert.equal(result.created, false);
  assert.equal(result.id, "log-race-1");
});

test("WhatsApp webhook idempotency processes different providerMessageSid values", async () => {
  const fake = createFakeWhatsAppLogStore();
  const base = {
    organizationId: "org-1",
    body: "hello",
    fromNumber: "972501111111",
    toNumber: "14155238886",
    mediaCount: 0,
    mediaJson: [],
  };

  const first = await createInboundWhatsAppLogOnce({ ...base, providerMessageSid: "SM123" }, fake.store);
  const second = await createInboundWhatsAppLogOnce({ ...base, providerMessageSid: "SM456" }, fake.store);

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.equal(fake.logs.length, 2);
});

test("owner WhatsApp calendar reply is sent even when auto-reply is disabled", async () => {
  const reply = await resolveOwnerAssistantWhatsAppReply(
    {
      organizationId: "org-1",
      body: "תקבעי תור לשרית מחר ב-3",
      normalizedFrom: "972501111111",
      mediaReply: null,
      autoReplyEnabled: false,
    },
    {
      maybeHandleCalendar: async () => "לאשר לקבוע תור לשרית מחר ב-15:00?",
      handleOwner: async () => "owner-chat-should-not-run",
    }
  );

  assert.equal(reply, "לאשר לקבוע תור לשרית מחר ב-15:00?");
});

test("owner WhatsApp non-calendar chatter stays behind auto-reply gate", async () => {
  const reply = await resolveOwnerAssistantWhatsAppReply(
    {
      organizationId: "org-1",
      body: "שלום",
      normalizedFrom: "972501111111",
      mediaReply: null,
      autoReplyEnabled: false,
    },
    {
      maybeHandleCalendar: async () => null,
      handleOwner: async () => "owner-chat",
    }
  );

  assert.equal(reply, null);
});

test("owner WhatsApp falls back to owner chat when auto-reply is enabled", async () => {
  const reply = await resolveOwnerAssistantWhatsAppReply(
    {
      organizationId: "org-1",
      body: "שלום",
      normalizedFrom: "972501111111",
      mediaReply: null,
      autoReplyEnabled: true,
    },
    {
      maybeHandleCalendar: async () => null,
      handleOwner: async () => "owner-chat",
    }
  );

  assert.equal(reply, "owner-chat");
});

test("Hebrew calendar commands are not junk-filter REAL (owner path bypasses junk gate)", () => {
  const decision = classifyJunk({
    body: "תקבעי תור לשרית מחר ב-3",
    sender: "whatsapp:+972501111111",
    channel: "whatsapp",
  });
  assert.equal(decision.bucket, "UNSURE");
  assert.equal(shouldAutoClassifyAfterJunkFilter(decision), false);
});
