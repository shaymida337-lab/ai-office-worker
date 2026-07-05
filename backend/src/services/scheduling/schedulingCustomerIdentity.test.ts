import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { resolveSchedulingCustomerMatches, searchSchedulingCustomers } from "./schedulingCustomer.js";

const ORG = "org-identity";

test("placeholder emails are excluded from scheduling lookup", async () => {
  const original = prisma.client.findMany.bind(prisma.client);
  prisma.client.findMany = (async () => [
    {
      id: "placeholder-client",
      name: "David Cohen",
      email: "natalie-david@scheduling.local",
      whatsappNumber: null,
      emailIsPlaceholder: true,
    },
    {
      id: "real-client",
      name: "David Cohen",
      email: "david@example.com",
      whatsappNumber: null,
      emailIsPlaceholder: false,
    },
  ]) as typeof prisma.client.findMany;

  try {
    const matches = await searchSchedulingCustomers({
      organizationId: ORG,
      query: "natalie-david@scheduling.local",
    });
    assert.equal(matches.length, 0);
  } finally {
    prisma.client.findMany = original;
  }
});

test("resolveSchedulingCustomerMatches prioritizes phone before email and name", async () => {
  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  let lastWhere: unknown;

  prisma.client.findMany = (async (args) => {
    lastWhere = args?.where;
    if ((args?.where as { whatsappNumber?: unknown })?.whatsappNumber) {
      return [
        {
          id: "by-phone",
          name: "David Cohen",
          email: null,
          whatsappNumber: "0501234567",
          emailIsPlaceholder: false,
        },
      ];
    }
    return [];
  }) as typeof prisma.client.findMany;

  try {
    const matches = await resolveSchedulingCustomerMatches({
      organizationId: ORG,
      name: "Someone Else",
      phone: "0501234567",
      email: "other@example.com",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "by-phone");
    assert.ok((lastWhere as { whatsappNumber?: unknown })?.whatsappNumber);
  } finally {
    prisma.client.findMany = originalFindMany;
  }
});

test("real email lookup ignores placeholder flagged rows", async () => {
  const original = prisma.client.findMany.bind(prisma.client);
  prisma.client.findMany = (async (args) => {
    assert.equal((args?.where as { emailIsPlaceholder?: boolean })?.emailIsPlaceholder, false);
    return [
      {
        id: "real",
        name: "David Cohen",
        email: "david@example.com",
        whatsappNumber: null,
        emailIsPlaceholder: false,
      },
    ];
  }) as typeof prisma.client.findMany;

  try {
    const matches = await searchSchedulingCustomers({
      organizationId: ORG,
      query: "david@example.com",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "real");
  } finally {
    prisma.client.findMany = original;
  }
});
