import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import {
  applyRealEmailToClientInTx,
  getClientDeliverableEmail,
  isPlaceholderClientEmail,
  isRealClientEmail,
  normalizeClientEmailInput,
} from "./clientContact.js";
import { createSchedulingCustomerInTx } from "./scheduling/schedulingCustomer.js";

test("customer can be created without email", async () => {
  const originalCount = prisma.client.count.bind(prisma.client);
  const originalCreate = prisma.client.create.bind(prisma.client);

  prisma.client.count = (async () => 0) as typeof prisma.client.count;
  prisma.client.create = (async (args) => ({
    id: "client-no-email",
    name: args.data.name,
    email: args.data.email ?? null,
    whatsappNumber: args.data.whatsappNumber ?? null,
    emailIsPlaceholder: args.data.emailIsPlaceholder ?? false,
  })) as typeof prisma.client.create;

  try {
    const client = await createSchedulingCustomerInTx(prisma as never, {
      organizationId: "org-1",
      customer: { name: "David Cohen" },
    });
    assert.equal(client.email, null);
    assert.equal(client.emailIsPlaceholder, false);
  } finally {
    prisma.client.count = originalCount;
    prisma.client.create = originalCreate;
  }
});

test("placeholder emails are excluded from deliverable email", () => {
  assert.equal(isPlaceholderClientEmail("natalie-david@scheduling.local"), true);
  assert.equal(isRealClientEmail("natalie-david@scheduling.local"), false);
  assert.equal(getClientDeliverableEmail({ email: "natalie-david@scheduling.local" }), null);
  assert.equal(
    getClientDeliverableEmail({ email: "natalie-david@scheduling.local", emailIsPlaceholder: true }),
    null
  );
});

test("normalizeClientEmailInput rejects placeholder addresses", () => {
  assert.equal(normalizeClientEmailInput("david@example.com"), "david@example.com");
  assert.equal(normalizeClientEmailInput("natalie-x@scheduling.local"), null);
  assert.equal(normalizeClientEmailInput(""), null);
});

test("applyRealEmailToClientInTx replaces cleared placeholder and preserves client id", async () => {
  const state = {
    id: "client-merge",
    email: null as string | null,
    emailIsPlaceholder: true,
  };

  const originalFindFirst = prisma.client.findFirst.bind(prisma.client);
  const originalUpdate = prisma.client.update.bind(prisma.client);

  prisma.client.findFirst = (async (args) => {
    if (args?.where?.id && args.where.id !== state.id) return null;
    if (args?.where?.email) return null;
    return {
      id: state.id,
      name: "David Cohen",
      email: state.email,
      whatsappNumber: null,
      emailIsPlaceholder: state.emailIsPlaceholder,
    };
  }) as typeof prisma.client.findFirst;

  prisma.client.update = (async (args) => {
    state.email = args.data.email as string;
    state.emailIsPlaceholder = args.data.emailIsPlaceholder as boolean;
    return {
      id: state.id,
      name: "David Cohen",
      email: state.email,
      whatsappNumber: null,
      emailIsPlaceholder: state.emailIsPlaceholder,
    };
  }) as typeof prisma.client.update;

  try {
    const result = await applyRealEmailToClientInTx(prisma as never, {
      organizationId: "org-1",
      clientId: state.id,
      email: "david@example.com",
    });
    assert.equal(result.updated, true);
    assert.equal(result.email, "david@example.com");
    assert.equal(state.email, "david@example.com");
    assert.equal(state.emailIsPlaceholder, false);
  } finally {
    prisma.client.findFirst = originalFindFirst;
    prisma.client.update = originalUpdate;
  }
});

test("applyRealEmailToClientInTx does not overwrite an existing real email", async () => {
  const originalFindFirst = prisma.client.findFirst.bind(prisma.client);
  const originalUpdate = prisma.client.update.bind(prisma.client);

  prisma.client.findFirst = (async () => ({
    id: "client-real",
    email: "existing@example.com",
    emailIsPlaceholder: false,
  })) as typeof prisma.client.findFirst;
  prisma.client.update = (async () => {
    throw new Error("should not update");
  }) as typeof prisma.client.update;

  try {
    const result = await applyRealEmailToClientInTx(prisma as never, {
      organizationId: "org-1",
      clientId: "client-real",
      email: "new@example.com",
    });
    assert.equal(result.updated, false);
    assert.equal(result.email, "existing@example.com");
  } finally {
    prisma.client.findFirst = originalFindFirst;
    prisma.client.update = originalUpdate;
  }
});
