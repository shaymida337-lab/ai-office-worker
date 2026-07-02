import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import {
  AppointmentConflictError,
  checkAppointmentConflict,
  createAppointmentForOrganization,
} from "./appointmentService.js";

const ORG = "org-appt-test";
const CLIENT_ID = "client-1";

function at(iso: string) {
  return new Date(iso);
}

function existingRow(
  id: string,
  startTime: Date,
  durationMinutes: number,
  status = "confirmed"
) {
  return {
    id,
    startTime,
    durationMinutes,
    status,
    client: { name: `Client ${id}` },
  };
}

function mockFindMany(rows: ReturnType<typeof existingRow>[]) {
  const original = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.appointment.findMany = (async () => rows) as unknown as typeof prisma.appointment.findMany;
  return () => {
    prisma.appointment.findMany = original;
  };
}

function mockSchedulingTransaction() {
  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalExecuteRaw = prisma.$executeRaw.bind(prisma);
  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.$executeRaw = (async () => 1) as typeof prisma.$executeRaw;
  return () => {
    prisma.$transaction = originalTransaction;
    prisma.$executeRaw = originalExecuteRaw;
  };
}

test("checkAppointmentConflict detects overlapping appointments", async () => {
  const restore = mockFindMany([existingRow("a1", at("2026-06-20T10:00:00.000Z"), 60)]);
  try {
    const result = await checkAppointmentConflict({
      organizationId: ORG,
      startTime: at("2026-06-20T10:30:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflictingAppointment?.id, "a1");
  } finally {
    restore();
  }
});

test("checkAppointmentConflict allows non-overlapping appointments", async () => {
  const restore = mockFindMany([existingRow("a1", at("2026-06-20T10:00:00.000Z"), 60)]);
  try {
    const result = await checkAppointmentConflict({
      organizationId: ORG,
      startTime: at("2026-06-20T11:30:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(result.hasConflict, false);
  } finally {
    restore();
  }
});

test("checkAppointmentConflict allows back-to-back appointments", async () => {
  const restore = mockFindMany([existingRow("a1", at("2026-06-20T10:00:00.000Z"), 60)]);
  try {
    const result = await checkAppointmentConflict({
      organizationId: ORG,
      startTime: at("2026-06-20T11:00:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(result.hasConflict, false);
  } finally {
    restore();
  }
});

test("checkAppointmentConflict ignores cancelled appointments", async () => {
  const original = prisma.appointment.findMany.bind(prisma.appointment);
  let capturedWhere: unknown;
  prisma.appointment.findMany = (async (args: Parameters<typeof prisma.appointment.findMany>[0]) => {
    capturedWhere = args?.where;
    return [];
  }) as unknown as typeof prisma.appointment.findMany;
  try {
    const result = await checkAppointmentConflict({
      organizationId: ORG,
      startTime: at("2026-06-20T10:00:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(result.hasConflict, false);
    assert.deepEqual((capturedWhere as { status: { not: string } }).status, { not: "cancelled" });
  } finally {
    prisma.appointment.findMany = original;
  }
});

test("checkAppointmentConflict detects long-duration appointments that started before the new slot", async () => {
  const restore = mockFindMany([existingRow("long", at("2026-06-18T09:00:00.000Z"), 26 * 60)]);
  try {
    const result = await checkAppointmentConflict({
      organizationId: ORG,
      startTime: at("2026-06-19T10:00:00.000Z"),
      durationMinutes: 60,
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflictingAppointment?.id, "long");
  } finally {
    restore();
  }
});

test("createAppointmentForOrganization blocks manual overlapping creation", async () => {
  const restoreFindMany = mockFindMany([existingRow("existing", at("2026-06-20T10:00:00.000Z"), 60)]);
  const restoreTx = mockSchedulingTransaction();
  const originalFindClient = prisma.client.findFirst.bind(prisma.client);
  const originalCreate = prisma.appointment.create.bind(prisma.appointment);

  prisma.client.findFirst = (async () => ({ id: CLIENT_ID, name: "Test" })) as unknown as typeof prisma.client.findFirst;
  prisma.appointment.create = (async () => {
    throw new Error("should not create on conflict");
  }) as unknown as typeof prisma.appointment.create;

  try {
    await assert.rejects(
      () =>
        createAppointmentForOrganization({
          organizationId: ORG,
          clientId: CLIENT_ID,
          startTime: at("2026-06-20T10:30:00.000Z"),
          durationMinutes: 60,
          source: "manual",
        }),
      (err: unknown) => err instanceof AppointmentConflictError && err.code === "time_conflict"
    );
  } finally {
    restoreTx();
    restoreFindMany();
    prisma.client.findFirst = originalFindClient;
    prisma.appointment.create = originalCreate;
  }
});

test("createAppointmentForOrganization blocks Natalie overlapping creation", async () => {
  const restoreFindMany = mockFindMany([existingRow("existing", at("2026-06-20T14:00:00.000Z"), 30)]);
  const restoreTx = mockSchedulingTransaction();
  const originalFindClient = prisma.client.findFirst.bind(prisma.client);
  const originalCreate = prisma.appointment.create.bind(prisma.appointment);

  prisma.client.findFirst = (async () => ({ id: CLIENT_ID, name: "Test" })) as unknown as typeof prisma.client.findFirst;
  prisma.appointment.create = (async () => {
    throw new Error("should not create on conflict");
  }) as unknown as typeof prisma.appointment.create;

  try {
    await assert.rejects(
      () =>
        createAppointmentForOrganization({
          organizationId: ORG,
          clientId: CLIENT_ID,
          startTime: at("2026-06-20T14:15:00.000Z"),
          durationMinutes: 30,
          source: "natalie",
        }),
      (err: unknown) => err instanceof AppointmentConflictError
    );
  } finally {
    restoreTx();
    restoreFindMany();
    prisma.client.findFirst = originalFindClient;
    prisma.appointment.create = originalCreate;
  }
});

test("createAppointmentForOrganization creates non-overlapping appointments", async () => {
  const restoreFindMany = mockFindMany([]);
  const restoreTx = mockSchedulingTransaction();
  const originalFindClient = prisma.client.findFirst.bind(prisma.client);
  const originalCreate = prisma.appointment.create.bind(prisma.appointment);
  const originalIntegration = prisma.integration.findUnique.bind(prisma.integration);

  const startTime = at("2026-06-21T09:00:00.000Z");
  const created = {
    id: "new-appt",
    organizationId: ORG,
    clientId: CLIENT_ID,
    serviceId: null,
    startTime,
    durationMinutes: 30,
    status: "pending",
    source: "manual",
    notes: null,
    googleEventId: null,
    createdAt: startTime,
    updatedAt: startTime,
    client: { id: CLIENT_ID, name: "Test", whatsappNumber: null, color: null },
    service: null,
  };

  prisma.client.findFirst = (async () => ({ id: CLIENT_ID, name: "Test" })) as unknown as typeof prisma.client.findFirst;
  prisma.appointment.create = (async () => created) as unknown as typeof prisma.appointment.create;
  prisma.integration.findUnique = (async () => null) as unknown as typeof prisma.integration.findUnique;

  try {
    const result = await createAppointmentForOrganization({
      organizationId: ORG,
      clientId: CLIENT_ID,
      startTime,
      durationMinutes: 30,
      source: "manual",
    });
    assert.equal(result.id, "new-appt");
  } finally {
    restoreTx();
    restoreFindMany();
    prisma.client.findFirst = originalFindClient;
    prisma.appointment.create = originalCreate;
    prisma.integration.findUnique = originalIntegration;
  }
});

test("createAppointmentForOrganization skips conflict check for cancelled status", async () => {
  const restoreTx = mockSchedulingTransaction();
  const originalFindMany = prisma.appointment.findMany.bind(prisma.appointment);
  const originalFindClient = prisma.client.findFirst.bind(prisma.client);
  const originalCreate = prisma.appointment.create.bind(prisma.appointment);
  const originalIntegration = prisma.integration.findUnique.bind(prisma.integration);

  let conflictChecked = false;
  const startTime = at("2026-06-20T10:00:00.000Z");
  const created = {
    id: "cancelled-appt",
    organizationId: ORG,
    clientId: CLIENT_ID,
    serviceId: null,
    startTime,
    durationMinutes: 60,
    status: "cancelled",
    source: "manual",
    notes: null,
    googleEventId: null,
    createdAt: startTime,
    updatedAt: startTime,
    client: { id: CLIENT_ID, name: "Test", whatsappNumber: null, color: null },
    service: null,
  };

  prisma.client.findFirst = (async () => ({ id: CLIENT_ID, name: "Test" })) as unknown as typeof prisma.client.findFirst;
  prisma.appointment.findMany = (async () => {
    conflictChecked = true;
    return [existingRow("existing", at("2026-06-20T10:00:00.000Z"), 60)];
  }) as unknown as typeof prisma.appointment.findMany;
  prisma.appointment.create = (async () => created) as unknown as typeof prisma.appointment.create;
  prisma.integration.findUnique = (async () => null) as unknown as typeof prisma.integration.findUnique;

  try {
    const result = await createAppointmentForOrganization({
      organizationId: ORG,
      clientId: CLIENT_ID,
      startTime,
      durationMinutes: 60,
      status: "cancelled",
      source: "manual",
    });
    assert.equal(result.status, "cancelled");
    assert.equal(conflictChecked, false);
  } finally {
    restoreTx();
    prisma.appointment.findMany = originalFindMany;
    prisma.client.findFirst = originalFindClient;
    prisma.appointment.create = originalCreate;
    prisma.integration.findUnique = originalIntegration;
  }
});
