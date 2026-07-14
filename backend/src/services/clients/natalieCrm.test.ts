import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { askNatalieBusinessQuestion } from "../natalie.js";
import { executeNataliePendingProposal } from "../conversation/voice/natalieProposalExecution.js";
import { parseNatalieCrmIntent } from "./natalieCrm.js";

const ORG = "org-natalie-crm";
const TZ = "Asia/Jerusalem";

const CLIENT_SARIT = {
  id: "client-sarit-crm",
  name: "שרית",
  email: "sarit@example.com",
  whatsappNumber: "0501111111",
  emailIsPlaceholder: false,
};

const CLIENT_DANI_A = {
  id: "client-dani-a",
  name: "דני כהן",
  email: null as string | null,
  whatsappNumber: null as string | null,
  emailIsPlaceholder: true,
};

const CLIENT_DANI_B = {
  id: "client-dani-b",
  name: "דני לוי",
  email: null as string | null,
  whatsappNumber: null as string | null,
  emailIsPlaceholder: true,
};

type Store = {
  clients: Array<typeof CLIENT_SARIT | typeof CLIENT_DANI_A>;
  appointments: Array<{
    id: string;
    clientId: string;
    startTime: Date;
    durationMinutes: number;
    status: string;
    notes: string | null;
    service: { name: string; price: number | null } | null;
    employee: { name: string } | null;
  }>;
  updates: Array<Record<string, unknown>>;
};

function installCrmMocks(store: Store) {
  const originals = {
    org: prisma.organization.findUnique.bind(prisma.organization),
    clientFindMany: prisma.client.findMany.bind(prisma.client),
    clientFindFirst: prisma.client.findFirst.bind(prisma.client),
    clientUpdate: prisma.client.update.bind(prisma.client),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    integrationFindUnique: prisma.integration.findUnique.bind(prisma.integration),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: TZ,
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;

  prisma.integration.findUnique = (async () => null) as typeof prisma.integration.findUnique;

  prisma.client.findMany = (async (args) => {
    const where = args?.where as {
      organizationId?: string;
      isActive?: boolean;
      name?: { equals?: string; contains?: string; mode?: string } | string;
      whatsappNumber?: { contains?: string };
      email?: { equals?: string; mode?: string };
      OR?: Array<Record<string, unknown>>;
    };
    if (where?.organizationId && where.organizationId !== ORG) return [];
    let rows = store.clients.map((c) => ({
      ...c,
      isActive: true,
      organizationId: ORG,
      phone: (c as { phone?: string | null }).phone ?? null,
      address: (c as { address?: string | null }).address ?? null,
    }));

    const nameFilter = where?.name;
    if (typeof nameFilter === "string") {
      const needle = nameFilter.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase() === needle);
    } else if (nameFilter && typeof nameFilter === "object") {
      if (typeof nameFilter.equals === "string") {
        const needle = nameFilter.equals.toLowerCase();
        rows = rows.filter((c) => c.name.toLowerCase() === needle);
      } else if (typeof nameFilter.contains === "string") {
        const needle = nameFilter.contains.toLowerCase();
        rows = rows.filter((c) => c.name.toLowerCase().includes(needle));
      }
    }
    return rows;
  }) as typeof prisma.client.findMany;

  prisma.client.findFirst = (async (args) => {
    const where = args?.where as {
      id?: string;
      organizationId?: string;
      isActive?: boolean;
      email?: { equals?: string; mode?: string };
    };
    if (where?.organizationId && where.organizationId !== ORG) return null;
    if (where?.id) {
      const hit = store.clients.find((c) => c.id === where.id);
      return hit
        ? { ...hit, isActive: true, organizationId: ORG, phone: (hit as { phone?: string | null }).phone ?? null, address: (hit as { address?: string | null }).address ?? null }
        : null;
    }
    return null;
  }) as typeof prisma.client.findFirst;

  prisma.client.update = (async (args) => {
    const id = (args as { where: { id: string } }).where.id;
    const data = (args as { data: Record<string, unknown> }).data;
    store.updates.push({ id, ...data });
    const idx = store.clients.findIndex((c) => c.id === id);
    if (idx >= 0) {
      store.clients[idx] = { ...store.clients[idx]!, ...data } as (typeof store.clients)[number];
    }
    const client = store.clients.find((c) => c.id === id)!;
    return { ...client, isActive: true, organizationId: ORG, phone: null, address: null, updatedAt: new Date(), createdAt: new Date() };
  }) as typeof prisma.client.update;

  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string; clientId?: string };
    if (where.organizationId !== ORG) return [];
    return store.appointments
      .filter((a) => !where.clientId || a.clientId === where.clientId)
      .map((a) => ({
        id: a.id,
        clientId: a.clientId,
        startTime: a.startTime,
        durationMinutes: a.durationMinutes,
        status: a.status,
        notes: a.notes,
        service: a.service,
        employee: a.employee,
      }));
  }) as typeof prisma.appointment.findMany;

  return () => {
    prisma.organization.findUnique = originals.org;
    prisma.client.findMany = originals.clientFindMany;
    prisma.client.findFirst = originals.clientFindFirst;
    prisma.client.update = originals.clientUpdate;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.integration.findUnique = originals.integrationFindUnique;
  };
}

const throwingClaude = {
  loadTimezone: async () => TZ,
  askClaude: async () => {
    throw new Error("Claude must not be called for deterministic CRM");
  },
};

test("parser: open / update / history intents", () => {
  assert.equal(parseNatalieCrmIntent("תפתחי את הכרטיס של שרית").kind, "open_client");
  assert.equal(parseNatalieCrmIntent("תעדכני לשרית את הטלפון ל-0501234567").field, "phone");
  assert.equal(parseNatalieCrmIntent("תחליפי את המייל של שרית ל-new@x.com").field, "email");
  assert.equal(parseNatalieCrmIntent("תעדכני לשרית את הכתובת ל-הרצל 1").field, "address");
  assert.equal(parseNatalieCrmIntent("תראי לי את כל ההיסטוריה של שרית").kind, "list_client_history");
});

test("CRM: open client card returns open_client action with path", async () => {
  const store: Store = { clients: [CLIENT_SARIT], appointments: [], updates: [] };
  const restore = installCrmMocks(store);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תפתחי את הכרטיס של שרית" },
      throwingClaude
    );
    assert.equal("action" in res && res.action, "open_client");
    if ("action" in res && res.action === "open_client") {
      assert.equal(res.proposal.clientId, CLIENT_SARIT.id);
      assert.equal(res.proposal.path, `/dashboard/clients/${CLIENT_SARIT.id}`);
    }
    assert.match(res.answer, /שרית/);
    assert.match(res.answer, /\/dashboard\/clients\//);
  } finally {
    restore();
  }
});

test("CRM: update phone confirms then persists via updateClientProfile", async () => {
  const store: Store = { clients: [{ ...CLIENT_SARIT }], appointments: [], updates: [] };
  const restore = installCrmMocks(store);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תעדכני לשרית את הטלפון ל-0509998877" },
      throwingClaude
    );
    assert.equal("action" in res && res.action, "update_client");
    if (!("action" in res) || res.action !== "update_client") return;
    assert.equal(res.proposal.field, "phone");
    assert.equal(res.proposal.value, "0509998877");
    assert.match(res.answer, /לאשר/);

    const executed = await executeNataliePendingProposal({
      organizationId: ORG,
      userId: "user-1",
      action: "update_client",
      proposal: res.proposal as unknown as Record<string, unknown>,
    });
    assert.equal(executed.ok, true);
    assert.ok(store.updates.some((u) => u.id === CLIENT_SARIT.id));
    assert.match(executed.message, /0509998877/);
  } finally {
    restore();
  }
});

test("CRM: update email confirms with update_client proposal", async () => {
  const store: Store = { clients: [{ ...CLIENT_SARIT }], appointments: [], updates: [] };
  const restore = installCrmMocks(store);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תחליפי את המייל של שרית ל-sarit.new@example.com" },
      throwingClaude
    );
    assert.equal("action" in res && res.action, "update_client");
    if ("action" in res && res.action === "update_client") {
      assert.equal(res.proposal.field, "email");
      assert.equal(res.proposal.value, "sarit.new@example.com");
    }
  } finally {
    restore();
  }
});

test("CRM: update address confirms with update_client proposal", async () => {
  const store: Store = { clients: [{ ...CLIENT_SARIT }], appointments: [], updates: [] };
  const restore = installCrmMocks(store);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תעדכני לשרית את הכתובת ל-דיזנגוף 10 תל אביב" },
      throwingClaude
    );
    assert.equal("action" in res && res.action, "update_client");
    if ("action" in res && res.action === "update_client") {
      assert.equal(res.proposal.field, "address");
      assert.match(res.proposal.value, /דיזנגוף/);
    }
  } finally {
    restore();
  }
});

test("CRM: full appointment history uses listClientAppointments (past + future)", async () => {
  const past = new Date("2026-01-10T10:00:00.000Z");
  const future = new Date("2026-12-10T10:00:00.000Z");
  const store: Store = {
    clients: [CLIENT_SARIT],
    appointments: [
      {
        id: "past-1",
        clientId: CLIENT_SARIT.id,
        startTime: past,
        durationMinutes: 30,
        status: "confirmed",
        notes: null,
        service: { name: "תספורת", price: 80 },
        employee: { name: "נועה" },
      },
      {
        id: "future-1",
        clientId: CLIENT_SARIT.id,
        startTime: future,
        durationMinutes: 45,
        status: "confirmed",
        notes: null,
        service: { name: "צביעה", price: 200 },
        employee: null,
      },
    ],
    updates: [],
  };
  const restore = installCrmMocks(store);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תראי לי את כל ההיסטוריה של שרית" },
      throwingClaude
    );
    assert.ok(!("action" in res) || !res.action);
    assert.match(res.answer ?? "", /היסטוריה/);
    assert.match(res.answer ?? "", /תספורת/);
    assert.match(res.answer ?? "", /צביעה/);
    assert.match(res.answer ?? "", /2/);
  } finally {
    restore();
  }
});

test("CRM: duplicate name asks which client", async () => {
  const store: Store = {
    clients: [CLIENT_DANI_A, CLIENT_DANI_B],
    appointments: [],
    updates: [],
  };
  const restore = installCrmMocks(store);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תפתחי את הכרטיס של דני" },
      throwingClaude
    );
    assert.ok(!("action" in res) || !res.action);
    assert.match(res.answer ?? "", /למי התכוונת/);
    assert.match(res.answer ?? "", /דני כהן/);
    assert.match(res.answer ?? "", /דני לוי/);
  } finally {
    restore();
  }
});
