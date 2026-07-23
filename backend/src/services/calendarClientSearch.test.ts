import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import { CALENDAR_BOOTSTRAP_CLIENTS_LIMIT } from "./calendarBootstrap.js";
import { searchCalendarClients } from "./calendarClientSearch.js";

const ORG = "org-cal-client-search";

test("calendar client search finds client beyond bootstrap summary limit (201+)", async () => {
  const originals = {
    clientFindMany: prisma.client.findMany.bind(prisma.client),
    clientFindFirst: prisma.client.findFirst.bind(prisma.client),
  };

  // Simulate org with 201 clients; bootstrap summary would only keep newest 200.
  const clients = Array.from({ length: 201 }, (_, i) => ({
    id: `c-${i + 1}`,
    name: i === 200 ? "לקוח אחרון 201" : `Client ${i + 1}`,
    email: null,
    whatsappNumber: i === 200 ? "0509999201" : `0500000${String(i).padStart(3, "0")}`,
    emailIsPlaceholder: true,
    organizationId: ORG,
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
  }));

  // Oldest client (index 0) would fall outside bootstrap take:200 ordered by createdAt desc.
  const beyondSummary = clients[0]!;
  assert.ok(clients.length > CALENDAR_BOOTSTRAP_CLIENTS_LIMIT);

  prisma.client.findMany = (async (args: {
    where?: { organizationId?: string; name?: { equals?: string; contains?: string; mode?: string } };
    take?: number;
  }) => {
    const org = args?.where?.organizationId;
    if (org && org !== ORG) return [];
    const nameEq = args?.where?.name?.equals;
    const nameContains = args?.where?.name?.contains;
    let rows = clients;
    if (nameEq) rows = clients.filter((c) => c.name === nameEq);
    if (nameContains) rows = clients.filter((c) => c.name.includes(nameContains));
    return rows.slice(0, args?.take ?? rows.length);
  }) as typeof prisma.client.findMany;

  prisma.client.findFirst = (async (args: { where?: { id?: string; organizationId?: string } }) => {
    if (args?.where?.organizationId && args.where.organizationId !== ORG) return null;
    if (args?.where?.id) return clients.find((c) => c.id === args.where!.id) ?? null;
    return null;
  }) as typeof prisma.client.findFirst;

  try {
    const byName = await searchCalendarClients({
      organizationId: ORG,
      query: beyondSummary.name,
    });
    assert.ok(byName.some((hit) => hit.id === beyondSummary.id));
    assert.equal(byName[0]!.id, beyondSummary.id);

    const byId = await searchCalendarClients({
      organizationId: ORG,
      clientId: beyondSummary.id,
    });
    assert.equal(byId.length, 1);
    assert.equal(byId[0]!.id, beyondSummary.id);
    assert.equal(byId[0]!.name, beyondSummary.name);

    // Still bounded — never returns unbounded dump.
    const fuzzy = await searchCalendarClients({ organizationId: ORG, query: "Client" });
    assert.ok(fuzzy.length <= 20);
  } finally {
    prisma.client.findMany = originals.clientFindMany;
    prisma.client.findFirst = originals.clientFindFirst;
  }
});
