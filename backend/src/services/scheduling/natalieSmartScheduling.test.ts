import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { AppointmentConflictError } from "../appointmentService.js";
import { executeNataliePendingProposal } from "../conversation/voice/natalieProposalExecution.js";
import {
  bookAppointmentViaNatalie,
  SchedulingFacadeError,
} from "./schedulingFacade.js";
import { scheduleNatalieAppointmentAtomic } from "./schedulingBookWorkflow.js";

const ORG = "org-natalie-smart";
const USER = "user-natalie-smart";
const EXISTING_CLIENT_ID = "client-existing";
const FUTURE_START = "2026-12-15T10:00:00.000Z";

function disableEngineFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

function mockOrganizationTimezone() {
  const original = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  return () => {
    prisma.organization.findUnique = original;
  };
}

function mockEmptyCombinedBlocks() {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  return () => {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  };
}

function mockPassthroughTransaction() {
  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalExecuteRaw = prisma.$executeRaw.bind(prisma);
  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.$executeRaw = (async () => 1) as typeof prisma.$executeRaw;
  return () => {
    prisma.$transaction = originalTransaction;
    prisma.$executeRaw = originalExecuteRaw;
  };
}

test("bookAppointmentViaNatalie uses existing customer when exactly one match", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreOrg = mockOrganizationTimezone();
  const restoreTx = mockPassthroughTransaction();

  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  const originalCreateClient = prisma.client.create.bind(prisma.client);
  const originalCreateAppt = prisma.appointment.create.bind(prisma.appointment);
  const originalFindFirst = prisma.appointment.findFirst.bind(prisma.appointment);

  let clientCreated = false;
  prisma.client.findMany = (async () => [
    {
      id: EXISTING_CLIENT_ID,
      name: "David Cohen",
      email: "david@example.com",
      whatsappNumber: "0501234567",
    },
  ]) as typeof prisma.client.findMany;
  prisma.client.create = (async () => {
    clientCreated = true;
    throw new Error("should not create client");
  }) as typeof prisma.client.create;
  prisma.appointment.create = (async (args) => ({
    id: "appt-existing",
    organizationId: args.data.organizationId,
    clientId: args.data.clientId,
    serviceId: args.data.serviceId ?? null,
    startTime: args.data.startTime,
    durationMinutes: args.data.durationMinutes,
    status: args.data.status ?? "pending",
    source: args.data.source ?? "natalie",
    notes: args.data.notes ?? null,
    googleEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    client: { id: EXISTING_CLIENT_ID, name: "David Cohen", whatsappNumber: "0501234567", color: null },
    service: null,
  })) as typeof prisma.appointment.create;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;

  try {
    const result = await bookAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      clientName: "David Cohen",
      startTime: FUTURE_START,
      durationMinutes: 30,
    });
    assert.equal(result.engine, false);
    assert.equal(result.appointment.clientId, EXISTING_CLIENT_ID);
    assert.equal(clientCreated, false);
  } finally {
    restoreBlocks();
    restoreOrg();
    restoreTx();
    prisma.client.findMany = originalFindMany;
    prisma.client.create = originalCreateClient;
    prisma.appointment.create = originalCreateAppt;
    prisma.appointment.findFirst = originalFindFirst;
  }
});

test("bookAppointmentViaNatalie auto-creates customer when none exists", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreOrg = mockOrganizationTimezone();
  const restoreTx = mockPassthroughTransaction();

  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  const originalCount = prisma.client.count.bind(prisma.client);
  const originalCreateClient = prisma.client.create.bind(prisma.client);
  const originalCreateAppt = prisma.appointment.create.bind(prisma.appointment);
  const originalFindFirst = prisma.appointment.findFirst.bind(prisma.appointment);

  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;
  prisma.client.count = (async () => 0) as typeof prisma.client.count;
  prisma.client.create = (async (args) => ({
    id: "client-new",
    name: args.data.name,
    email: args.data.email,
    whatsappNumber: args.data.whatsappNumber ?? null,
  })) as typeof prisma.client.create;
  prisma.appointment.create = (async (args) => ({
    id: "appt-new",
    organizationId: args.data.organizationId,
    clientId: args.data.clientId,
    serviceId: args.data.serviceId ?? null,
    startTime: args.data.startTime,
    durationMinutes: args.data.durationMinutes,
    status: args.data.status ?? "pending",
    source: args.data.source ?? "natalie",
    notes: args.data.notes ?? null,
    googleEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    client: { id: "client-new", name: "David Cohen", whatsappNumber: null, color: null },
    service: null,
  })) as typeof prisma.appointment.create;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;

  try {
    const result = await bookAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      clientName: "David Cohen",
      startTime: FUTURE_START,
      durationMinutes: 30,
    });
    assert.equal(result.engine, false);
    assert.equal(result.appointment.clientId, "client-new");
    assert.equal(result.appointment.client.name, "David Cohen");
  } finally {
    restoreBlocks();
    restoreOrg();
    restoreTx();
    prisma.client.findMany = originalFindMany;
    prisma.client.count = originalCount;
    prisma.client.create = originalCreateClient;
    prisma.appointment.create = originalCreateAppt;
    prisma.appointment.findFirst = originalFindFirst;
  }
});

test("bookAppointmentViaNatalie rejects duplicate customer names without guessing", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreOrg = mockOrganizationTimezone();

  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  prisma.client.findMany = (async () => [
    { id: "c-1", name: "David Cohen", email: "a@example.com", whatsappNumber: "0501111111" },
    { id: "c-2", name: "David Cohen", email: "b@example.com", whatsappNumber: "0502222222" },
  ]) as typeof prisma.client.findMany;

  try {
    await assert.rejects(
      () =>
        bookAppointmentViaNatalie({
          organizationId: ORG,
          userId: USER,
          clientName: "David Cohen",
          startTime: FUTURE_START,
          durationMinutes: 30,
        }),
      (err: unknown) => {
        assert.ok(err instanceof SchedulingFacadeError);
        assert.equal(err.code, "multiple_clients");
        assert.match(err.message, /2 לקוחות בשם David Cohen/);
        return true;
      }
    );
  } finally {
    restoreBlocks();
    restoreOrg();
    prisma.client.findMany = originalFindMany;
  }
});

test("bookAppointmentViaNatalie books new customer without phone or email", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreOrg = mockOrganizationTimezone();
  const restoreTx = mockPassthroughTransaction();

  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  const originalCount = prisma.client.count.bind(prisma.client);
  const originalCreateClient = prisma.client.create.bind(prisma.client);
  const originalCreateAppt = prisma.appointment.create.bind(prisma.appointment);
  const originalFindFirst = prisma.appointment.findFirst.bind(prisma.appointment);

  let savedEmail: string | null | undefined = "unset";
  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;
  prisma.client.count = (async () => 1) as typeof prisma.client.count;
  prisma.client.create = (async (args) => {
    savedEmail = args.data.email ?? null;
    return {
      id: "client-minimal",
      name: args.data.name,
      email: args.data.email ?? null,
      whatsappNumber: args.data.whatsappNumber ?? null,
      emailIsPlaceholder: args.data.emailIsPlaceholder ?? false,
    };
  }) as typeof prisma.client.create;
  prisma.appointment.create = (async (args) => ({
    id: "appt-minimal",
    organizationId: args.data.organizationId,
    clientId: args.data.clientId,
    serviceId: null,
    startTime: args.data.startTime,
    durationMinutes: args.data.durationMinutes,
    status: "pending",
    source: "natalie",
    notes: args.data.notes ?? null,
    googleEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    client: { id: "client-minimal", name: "David Cohen", whatsappNumber: null, color: null },
    service: null,
  })) as typeof prisma.appointment.create;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;

  try {
    const result = await bookAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      clientName: "David Cohen",
      startTime: FUTURE_START,
      durationMinutes: 30,
    });
    assert.equal(result.engine, false);
    assert.equal(savedEmail, null);
  } finally {
    restoreBlocks();
    restoreOrg();
    restoreTx();
    prisma.client.findMany = originalFindMany;
    prisma.client.count = originalCount;
    prisma.client.create = originalCreateClient;
    prisma.appointment.create = originalCreateAppt;
    prisma.appointment.findFirst = originalFindFirst;
  }
});

test("scheduleNatalieAppointmentAtomic rolls back when appointment creation fails", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreOrg = mockOrganizationTimezone();

  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalExecuteRaw = prisma.$executeRaw.bind(prisma);
  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  const originalCount = prisma.client.count.bind(prisma.client);

  const persistedClients: string[] = [];

  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;
  prisma.client.count = (async () => 0) as typeof prisma.client.count;

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => {
    const tx = {
      ...prisma,
      client: {
        ...prisma.client,
        findMany: prisma.client.findMany,
        findFirst: prisma.client.findFirst,
        count: prisma.client.count,
        create: (async (args: Parameters<typeof prisma.client.create>[0]) => {
          const row = {
            id: "tx-client",
            name: args.data.name,
            email: args.data.email,
            whatsappNumber: args.data.whatsappNumber ?? null,
          };
          persistedClients.push(row.id);
          return row;
        }) as typeof prisma.client.create,
      },
      appointment: {
        ...prisma.appointment,
        findMany: prisma.appointment.findMany,
        create: (async () => {
          throw new AppointmentConflictError();
        }) as typeof prisma.appointment.create,
      },
    };
    try {
      return await fn(tx as typeof prisma);
    } catch (err) {
      persistedClients.length = 0;
      throw err;
    }
  }) as typeof prisma.$transaction;
  prisma.$executeRaw = (async () => 1) as typeof prisma.$executeRaw;

  try {
    await assert.rejects(
      () =>
        scheduleNatalieAppointmentAtomic({
          organizationId: ORG,
          userId: USER,
          engineEnabled: false,
          slot: {
            organizationId: ORG,
            startTime: new Date(FUTURE_START),
            durationMinutes: 30,
            serviceId: null,
            timeZone: "UTC",
          },
          customer: { clientName: "New Person" },
        }),
      (err: unknown) => err instanceof AppointmentConflictError
    );
    assert.equal(persistedClients.length, 0);
  } finally {
    restoreBlocks();
    restoreOrg();
    prisma.$transaction = originalTransaction;
    prisma.$executeRaw = originalExecuteRaw;
    prisma.client.findMany = originalFindMany;
    prisma.client.count = originalCount;
  }
});

test("executeNataliePendingProposal book_appointment uses shared scheduling workflow (voice)", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreOrg = mockOrganizationTimezone();
  const restoreTx = mockPassthroughTransaction();

  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  const originalCount = prisma.client.count.bind(prisma.client);
  const originalCreateClient = prisma.client.create.bind(prisma.client);
  const originalCreateAppt = prisma.appointment.create.bind(prisma.appointment);
  const originalFindFirst = prisma.appointment.findFirst.bind(prisma.appointment);

  prisma.client.findMany = (async () => [
    {
      id: EXISTING_CLIENT_ID,
      name: "David Cohen",
      email: "david@example.com",
      whatsappNumber: "0501234567",
    },
  ]) as typeof prisma.client.findMany;
  prisma.client.create = (async () => {
    throw new Error("should not create");
  }) as typeof prisma.client.create;
  prisma.client.count = originalCount;
  prisma.appointment.create = (async (args) => ({
    id: "appt-voice",
    organizationId: args.data.organizationId,
    clientId: args.data.clientId,
    serviceId: null,
    startTime: args.data.startTime,
    durationMinutes: args.data.durationMinutes,
    status: "pending",
    source: "natalie",
    notes: null,
    googleEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    client: { id: EXISTING_CLIENT_ID, name: "David Cohen", whatsappNumber: "0501234567", color: null },
    service: null,
  })) as typeof prisma.appointment.create;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;

  try {
    const result = await executeNataliePendingProposal({
      organizationId: ORG,
      userId: USER,
      action: "book_appointment",
      proposal: {
        clientName: "David Cohen",
        startTime: FUTURE_START,
        durationMinutes: 30,
        clientPhone: "0501234567",
      },
    });
    assert.equal(result.ok, true);
    assert.match(result.message, /David Cohen/);
  } finally {
    restoreBlocks();
    restoreOrg();
    restoreTx();
    prisma.client.findMany = originalFindMany;
    prisma.client.count = originalCount;
    prisma.client.create = originalCreateClient;
    prisma.appointment.create = originalCreateAppt;
    prisma.appointment.findFirst = originalFindFirst;
  }
});

test("bookAppointmentViaNatalie chat path accepts optional phone and email on new customer", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreOrg = mockOrganizationTimezone();
  const restoreTx = mockPassthroughTransaction();

  const originalFindMany = prisma.client.findMany.bind(prisma.client);
  const originalCount = prisma.client.count.bind(prisma.client);
  const originalCreateClient = prisma.client.create.bind(prisma.client);
  const originalCreateAppt = prisma.appointment.create.bind(prisma.appointment);
  const originalFindFirst = prisma.appointment.findFirst.bind(prisma.appointment);

  let savedPhone: string | null = null;
  let savedEmail = "";

  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;
  prisma.client.count = (async () => 0) as typeof prisma.client.count;
  prisma.client.create = (async (args) => {
    savedPhone = args.data.whatsappNumber ?? null;
    savedEmail = args.data.email;
    return {
      id: "client-with-contact",
      name: args.data.name,
      email: args.data.email,
      whatsappNumber: args.data.whatsappNumber ?? null,
    };
  }) as typeof prisma.client.create;
  prisma.appointment.create = (async (args) => ({
    id: "appt-chat",
    organizationId: args.data.organizationId,
    clientId: args.data.clientId,
    serviceId: null,
    startTime: args.data.startTime,
    durationMinutes: args.data.durationMinutes,
    status: "pending",
    source: "natalie",
    notes: null,
    googleEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    client: { id: "client-with-contact", name: "David Cohen", whatsappNumber: savedPhone, color: null },
    service: null,
  })) as typeof prisma.appointment.create;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;

  try {
    const result = await bookAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      clientName: "David Cohen",
      clientPhone: "0501234567",
      clientEmail: "david@example.com",
      startTime: FUTURE_START,
      durationMinutes: 30,
    });
    assert.equal(result.engine, false);
    assert.equal(savedEmail, "david@example.com");
    assert.ok(savedPhone);
  } finally {
    restoreBlocks();
    restoreOrg();
    restoreTx();
    prisma.client.findMany = originalFindMany;
    prisma.client.count = originalCount;
    prisma.client.create = originalCreateClient;
    prisma.appointment.create = originalCreateAppt;
    prisma.appointment.findFirst = originalFindFirst;
  }
});
