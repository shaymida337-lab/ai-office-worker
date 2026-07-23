import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import {
  assertCalendarBootstrapPayloadBounds,
  CALENDAR_BOOTSTRAP_MAX_PAYLOAD_BYTES,
  getCalendarBootstrap,
} from "./calendarBootstrap.js";

const FORBIDDEN_MARKERS = [
  "googleapis",
  "google-auth-library",
  "ensureGmailAccessToken",
  "ensureGoogleCalendar",
  "fetchGoogle",
] as const;

const ORG = "org-cal-bootstrap-test";
const ORG_OTHER = "org-cal-bootstrap-other";

function installMocks(options?: { failClients?: boolean; empty?: boolean }) {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    employeeFindMany: prisma.employee.findMany.bind(prisma.employee),
    serviceFindMany: prisma.service.findMany.bind(prisma.service),
    clientFindMany: prisma.client.findMany.bind(prisma.client),
    integrationFindUnique: prisma.integration.findUnique.bind(prisma.integration),
  };

  let orgLookups = 0;
  let unbounded = false;

  prisma.organization.findUnique = (async (args: { where?: { id?: string } }) => {
    orgLookups += 1;
    const id = args?.where?.id;
    if (id !== ORG) return null;
    return {
      timezone: "Asia/Jerusalem",
      locale: "he-IL",
      weekStart: "sunday",
      calendarEngineReadEnabled: false,
      calendarEngineWriteEnabled: false,
      calendarEngineGoogleMirrorEnabled: false,
    };
  }) as typeof prisma.organization.findUnique;

  prisma.employee.findMany = (async (args: { where?: { organizationId?: string }; take?: number }) => {
    if (args?.take == null) unbounded = true;
    if (args?.where?.organizationId !== ORG) return [];
    if (options?.empty) return [];
    return [{ id: "e1", name: "Dana", color: "#3B82F6", isActive: true }];
  }) as typeof prisma.employee.findMany;

  prisma.service.findMany = (async (args: { where?: { organizationId?: string }; take?: number }) => {
    if (args?.take == null) unbounded = true;
    if (args?.where?.organizationId !== ORG) return [];
    if (options?.empty) return [];
    return [
      {
        id: "s1",
        name: "Meeting",
        durationMinutes: 30,
        price: 100,
        color: "#111",
        isActive: true,
        employeeLinks: [{ employeeId: "e1" }],
      },
    ];
  }) as typeof prisma.service.findMany;

  prisma.client.findMany = (async (args: { where?: { organizationId?: string }; take?: number }) => {
    if (args?.take == null) unbounded = true;
    if (options?.failClients) throw new Error("clients failed");
    if (args?.where?.organizationId !== ORG) return [];
    if (options?.empty) return [];
    return [{ id: "c1", name: "Client A", phone: "050" }];
  }) as typeof prisma.client.findMany;

  prisma.integration.findUnique = (async () => ({
    refreshToken: "rt",
    metadata: { calendarId: "primary" },
  })) as typeof prisma.integration.findUnique;

  return {
    orgLookups: () => orgLookups,
    unbounded: () => unbounded,
    restore() {
      prisma.organization.findUnique = originals.organizationFindUnique;
      prisma.employee.findMany = originals.employeeFindMany;
      prisma.service.findMany = originals.serviceFindMany;
      prisma.client.findMany = originals.clientFindMany;
      prisma.integration.findUnique = originals.integrationFindUnique;
    },
  };
}

test("calendar bootstrap org isolation and single org lookup", async () => {
  const mocks = installMocks();
  try {
    const payload = await getCalendarBootstrap(ORG);
    assert.equal(mocks.orgLookups(), 1);
    assert.equal(payload.employees.length, 1);
    assert.equal(payload.employees[0]!.name, "Dana");

    await assert.rejects(() => getCalendarBootstrap(ORG_OTHER), /Organization not found/);
  } finally {
    mocks.restore();
  }
});

test("calendar bootstrap zero-data organization", async () => {
  const mocks = installMocks({ empty: true });
  try {
    const payload = await getCalendarBootstrap(ORG);
    assert.equal(payload.employees.length, 0);
    assert.equal(payload.services.length, 0);
    assert.equal(payload.clientsSummary.length, 0);
    assert.equal(payload.connectionStatus.connected, true);
  } finally {
    mocks.restore();
  }
});

test("calendar bootstrap field whitelist, bounds, stable shape", async () => {
  const mocks = installMocks();
  try {
    const payload = await getCalendarBootstrap(ORG);
    assert.deepEqual(Object.keys(payload).sort(), [
      "capabilities",
      "clientsSummary",
      "connectionStatus",
      "employees",
      "generatedAt",
      "services",
      "settings",
    ]);
    assert.deepEqual(Object.keys(payload.settings).sort(), ["locale", "timezone", "workday"]);
    assert.equal("workingHours" in (payload.employees[0] as object), false);
    assert.equal("notes" in (payload.clientsSummary[0] as object), false);
    assertCalendarBootstrapPayloadBounds(payload);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(bytes < CALENDAR_BOOTSTRAP_MAX_PAYLOAD_BYTES);
    assert.equal(mocks.unbounded(), false);
  } finally {
    mocks.restore();
  }
});

test("calendar bootstrap capabilities parity with scheduling capabilities", async () => {
  const mocks = installMocks();
  try {
    const payload = await getCalendarBootstrap(ORG);
    assert.equal(typeof payload.capabilities.calendarEngineReadEnabled, "boolean");
    assert.equal(typeof payload.capabilities.calendarEngineWriteEnabled, "boolean");
    assert.equal(payload.capabilities.ownerDecisionQueueEnabled, payload.capabilities.calendarEngineReadEnabled);
    assert.ok(["global_disabled", "org_disabled", "enabled"].includes(payload.capabilities.source));
  } finally {
    mocks.restore();
  }
});

test("calendar bootstrap has no Google API markers", () => {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "calendarBootstrap.ts");
  const source = fs.readFileSync(filePath, "utf8");
  for (const marker of FORBIDDEN_MARKERS) {
    assert.equal(source.includes(marker), false, `forbidden marker present: ${marker}`);
  }
});

test("calendar bootstrap query failure does not return fake empty success for hard errors", async () => {
  const mocks = installMocks({ failClients: true });
  try {
    await assert.rejects(() => getCalendarBootstrap(ORG), /clients failed/);
  } finally {
    mocks.restore();
  }
});
