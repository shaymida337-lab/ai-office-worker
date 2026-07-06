import test from "node:test";
import assert from "node:assert/strict";
import { CommunicationService, bodyPreview } from "./communicationService.js";
import type { CommunicationEventRecord } from "./types.js";

function createFakeCommunicationDb() {
  const events = new Map<string, CommunicationEventRecord>();

  function key(organizationId: string, channel: string, externalMessageId: string) {
    return `${organizationId}:${channel}:${externalMessageId}`;
  }

  return {
    events,
    db: {
      communicationEvent: {
        async findMany(args: {
          where?: {
            id?: string;
            organizationId?: string;
            channel?: string;
            externalMessageId?: string;
            correlationId?: string;
            direction?: string;
            createdAt?: { gte?: Date; lte?: Date };
          };
          orderBy?: { createdAt: "desc" | "asc" };
          skip?: number;
          take?: number;
        }) {
          let rows = [...events.values()];
          const where = args.where ?? {};
          if (where.id) rows = rows.filter((row) => row.id === where.id);
          if (where.organizationId) rows = rows.filter((row) => row.organizationId === where.organizationId);
          if (where.channel) rows = rows.filter((row) => row.channel === where.channel);
          if (where.externalMessageId) rows = rows.filter((row) => row.externalMessageId === where.externalMessageId);
          if (where.correlationId) rows = rows.filter((row) => row.correlationId === where.correlationId);
          if (where.direction) rows = rows.filter((row) => row.direction === where.direction);
          if (where.createdAt?.gte) rows = rows.filter((row) => row.createdAt >= where.createdAt!.gte!);
          if (where.createdAt?.lte) rows = rows.filter((row) => row.createdAt <= where.createdAt!.lte!);
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          if (args.skip) rows = rows.slice(args.skip);
          if (args.take) rows = rows.slice(0, args.take);
          return rows;
        },
        async count(args: { where?: Parameters<typeof this.findMany>[0]["where"] }) {
          const rows = await this.findMany({ where: args.where });
          return rows.length;
        },
        async upsert(args: {
          where: { organizationId_channel_externalMessageId: { organizationId: string; channel: string; externalMessageId: string } };
          create: Omit<CommunicationEventRecord, "id" | "createdAt" | "updatedAt">;
          update: Partial<CommunicationEventRecord>;
        }) {
          const composite = args.where.organizationId_channel_externalMessageId;
          const mapKey = key(composite.organizationId, composite.channel, composite.externalMessageId);
          const existing = events.get(mapKey);
          const now = new Date();
          if (existing) {
            const updated: CommunicationEventRecord = {
              ...existing,
              ...args.update,
              updatedAt: now,
            };
            events.set(mapKey, updated);
            return updated;
          }
          const created: CommunicationEventRecord = {
            id: `ce_${events.size + 1}`,
            createdAt: now,
            updatedAt: now,
            ...args.create,
          };
          events.set(mapKey, created);
          return created;
        },
        async update(args: { where: { id: string }; data: Partial<CommunicationEventRecord> }) {
          const row = [...events.values()].find((item) => item.id === args.where.id);
          if (!row) throw new Error("not found");
          const updated = { ...row, ...args.data, updatedAt: new Date() };
          events.set(key(row.organizationId, row.channel, row.externalMessageId), updated);
          return updated;
        },
      },
    },
  };
}

test("bodyPreview truncates long text", () => {
  const long = "a".repeat(400);
  const preview = bodyPreview(long, 100);
  assert.ok(preview);
  assert.equal(preview!.length, 101);
  assert.ok(preview!.endsWith("…"));
});

test("createCommunicationEvent is idempotent on channel + externalMessageId", async () => {
  const fake = createFakeCommunicationDb();
  const service = new CommunicationService(fake.db);

  const envelope = {
    organizationId: "org-1",
    channel: "whatsapp",
    direction: "inbound",
    externalMessageId: "SM123",
    correlationId: "SM123",
    sender: "whatsapp:+972501111111",
    body: "hello",
  };

  const first = await service.createCommunicationEvent(envelope, { stage: "inbound_received" });
  const second = await service.createCommunicationEvent(envelope, { stage: "inbound_received" });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.event.id, second.event.id);
  assert.equal(fake.events.size, 1);
});

test("loadCommunicationHistory isolates organizations and filters by channel", async () => {
  const fake = createFakeCommunicationDb();
  const service = new CommunicationService(fake.db);

  await service.createCommunicationEvent({
    organizationId: "org-a",
    channel: "gmail",
    direction: "inbound",
    externalMessageId: "gmail-1",
    correlationId: "gmail-1",
    body: "org a mail",
  });
  await service.createCommunicationEvent({
    organizationId: "org-b",
    channel: "gmail",
    direction: "inbound",
    externalMessageId: "gmail-2",
    correlationId: "gmail-2",
    body: "org b mail",
  });
  await service.createCommunicationEvent({
    organizationId: "org-a",
    channel: "whatsapp",
    direction: "inbound",
    externalMessageId: "SM1",
    correlationId: "SM1",
    body: "wa",
  });

  const gmailOnly = await service.loadCommunicationHistory({
    organizationId: "org-a",
    channel: "gmail",
  });
  assert.equal(gmailOnly.total, 1);
  assert.equal(gmailOnly.items[0]?.externalMessageId, "gmail-1");

  const orgB = await service.loadCommunicationHistory({ organizationId: "org-b" });
  assert.equal(orgB.total, 1);
  assert.equal(orgB.items[0]?.organizationId, "org-b");
});

test("correlationId is stored and queryable", async () => {
  const fake = createFakeCommunicationDb();
  const service = new CommunicationService(fake.db);

  await service.createCommunicationEvent({
    organizationId: "org-1",
    channel: "web_voice",
    direction: "inbound",
    externalMessageId: "turn-abc",
    correlationId: "turn-abc",
    body: "קבע תור",
  });

  const history = await service.loadCommunicationHistory({
    organizationId: "org-1",
    correlationId: "turn-abc",
  });
  assert.equal(history.total, 1);
  assert.equal(history.items[0]?.correlationId, "turn-abc");
});

test("updateCommunicationEvent patches metadata stage", async () => {
  const fake = createFakeCommunicationDb();
  const service = new CommunicationService(fake.db);

  const created = await service.createCommunicationEvent({
    organizationId: "org-1",
    channel: "web_chat",
    direction: "inbound",
    externalMessageId: "msg-1",
    correlationId: "session-1",
    body: "שאלה",
  });

  const updated = await service.updateCommunicationEvent(created.event.organizationId, created.event.id, {
    stage: "processed",
    metadata: { handled: true },
  });

  assert.equal((updated.metadataJson as { stage?: string }).stage, "processed");
  assert.equal((updated.metadataJson as { handled?: boolean }).handled, true);
});
