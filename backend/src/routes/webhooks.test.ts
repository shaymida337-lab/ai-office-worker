import test from "node:test";
import assert from "node:assert/strict";
import { createInboundWhatsAppLogOnce } from "./webhooks.js";

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
