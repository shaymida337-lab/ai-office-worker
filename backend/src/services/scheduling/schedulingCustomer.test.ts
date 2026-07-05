import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  formatAmbiguousCustomerMessage,
  normalizeSchedulingCustomerName,
  normalizeSchedulingPhone,
  searchSchedulingCustomers,
} from "./schedulingCustomer.js";

const ORG = "org-customer-search";

test("searchSchedulingCustomers matches by exact name", async () => {
  const original = prisma.client.findMany.bind(prisma.client);
  prisma.client.findMany = (async () => [
  {
    id: "c-1",
    name: "David Cohen",
    email: "david@example.com",
    whatsappNumber: "0501234567",
  },
  ]) as typeof prisma.client.findMany;

  try {
    const matches = await searchSchedulingCustomers({
      organizationId: ORG,
      query: "David Cohen",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "c-1");
  } finally {
    prisma.client.findMany = original;
  }
});

test("searchSchedulingCustomers matches by phone suffix", async () => {
  const original = prisma.client.findMany.bind(prisma.client);
  prisma.client.findMany = (async () => [
    {
      id: "c-phone",
      name: "David Cohen",
      email: "david@example.com",
      whatsappNumber: "972501234567",
    },
  ]) as typeof prisma.client.findMany;

  try {
    const matches = await searchSchedulingCustomers({
      organizationId: ORG,
      query: "0501234567",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "c-phone");
  } finally {
    prisma.client.findMany = original;
  }
});

test("searchSchedulingCustomers matches by email", async () => {
  const original = prisma.client.findMany.bind(prisma.client);
  prisma.client.findMany = (async () => [
    {
      id: "c-email",
      name: "David Cohen",
      email: "david.cohen@example.com",
      whatsappNumber: null,
    },
  ]) as typeof prisma.client.findMany;

  try {
    const matches = await searchSchedulingCustomers({
      organizationId: ORG,
      query: "david.cohen@example.com",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "c-email");
  } finally {
    prisma.client.findMany = original;
  }
});

test("formatAmbiguousCustomerMessage names duplicate customers explicitly", () => {
  const message = formatAmbiguousCustomerMessage("David Cohen", [
    { id: "1", name: "David Cohen", email: "a@x.com", whatsappNumber: "0501111111" },
    { id: "2", name: "David Cohen", email: "b@x.com", whatsappNumber: "0502222222" },
  ]);
  assert.match(message, /2 לקוחות בשם David Cohen/);
  assert.match(message, /1\. David Cohen/);
  assert.match(message, /2\. David Cohen/);
});

test("normalizeSchedulingCustomerName collapses whitespace", () => {
  assert.equal(normalizeSchedulingCustomerName("  David   Cohen  "), "david cohen");
});

test("normalizeSchedulingPhone strips non-digits", () => {
  assert.equal(normalizeSchedulingPhone("050-123-4567"), "0501234567");
});
