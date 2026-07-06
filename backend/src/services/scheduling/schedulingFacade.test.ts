import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  bookAppointmentViaNatalie,
  cancelAppointmentViaNatalie,
  rescheduleAppointmentViaNatalie,
  usesCalendarEngineScheduling,
} from "./schedulingFacade.js";

const ORG = "org-facade-a";
const CLIENT_ID = "client-facade-1";
const USER = "user-facade-1";
const ACTOR = { actorType: "user" as const, actorUserId: USER };

function at(iso: string) {
  return new Date(iso);
}

function enableEngineFlags() {
  process.env.CALENDAR_ENGINE_V1_READ = "true";
  process.env.CALENDAR_ENGINE_V1_WRITE = "true";
}

function disableEngineFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
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

function mockClientLookup() {
  const original = prisma.client.findMany.bind(prisma.client);
  prisma.client.findMany = (async () => [
    { id: CLIENT_ID, name: "לקוח בדיקה", whatsappNumber: null, email: "client@example.com", emailIsPlaceholder: false },
  ]) as typeof prisma.client.findMany;
  return () => {
    prisma.client.findMany = original;
  };
}

function mockOrganizationTimezone(engineEnabled = false) {
  const original = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: engineEnabled,
    calendarEngineWriteEnabled: engineEnabled,
    calendarEngineGoogleMirrorEnabled: engineEnabled,
  })) as typeof prisma.organization.findUnique;
  return () => {
    prisma.organization.findUnique = original;
  };
}

test("usesCalendarEngineScheduling reflects global and org write flags", async () => {
  disableEngineFlags();
  const restoreOrg = mockOrgEngineFlags(false);
  assert.equal(await usesCalendarEngineScheduling(ORG), false);
  enableEngineFlags();
  assert.equal(await usesCalendarEngineScheduling(ORG), false);
  restoreOrg();
  const restoreEnabled = mockOrgEngineFlags(true);
  assert.equal(await usesCalendarEngineScheduling(ORG), true);
  restoreEnabled();
  disableEngineFlags();
});

function mockOrgEngineFlags(enabled: boolean) {
  const original = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({
    calendarEngineReadEnabled: enabled,
    calendarEngineWriteEnabled: enabled,
    calendarEngineGoogleMirrorEnabled: enabled,
  })) as typeof prisma.organization.findUnique;
  return () => {
    prisma.organization.findUnique = original;
  };
}

test("bookAppointmentViaNatalie uses legacy appointment path when engine OFF", async () => {
  disableEngineFlags();
  const restoreBlocks = mockEmptyCombinedBlocks();
  const restoreClient = mockClientLookup();
  const restoreOrg = mockOrganizationTimezone();

  const originalClientFirst = prisma.client.findFirst.bind(prisma.client);
  const originalCreate = prisma.appointment.create.bind(prisma.appointment);
  const originalUpdate = prisma.appointment.update.bind(prisma.appointment);
  const originalGoogle = prisma.appointment.findFirst.bind(prisma.appointment);
  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalExecuteRaw = prisma.$executeRaw.bind(prisma);

  prisma.client.findFirst = (async () => ({
    id: CLIENT_ID,
    organizationId: ORG,
    isActive: true,
  })) as typeof prisma.client.findFirst;

  prisma.appointment.create = (async (args) => ({
    id: "appt-facade-1",
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
    client: { id: CLIENT_ID, name: "לקוח בדיקה", whatsappNumber: null, color: null },
    service: null,
  })) as typeof prisma.appointment.create;

  prisma.appointment.update = originalUpdate;
  prisma.appointment.findFirst = (async () => null) as typeof prisma.appointment.findFirst;
  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.$executeRaw = (async () => 1) as typeof prisma.$executeRaw;

  try {
    const result = await bookAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      clientName: "לקוח בדיקה",
      startTime: "2026-12-01T10:00:00.000Z",
      durationMinutes: 30,
    });
    assert.equal(result.engine, false);
    assert.equal(result.appointment.id, "appt-facade-1");
  } finally {
    restoreBlocks();
    restoreClient();
    restoreOrg();
    prisma.client.findFirst = originalClientFirst;
    prisma.appointment.create = originalCreate;
    prisma.appointment.update = originalUpdate;
    prisma.appointment.findFirst = originalGoogle;
    prisma.$transaction = originalTransaction;
    prisma.$executeRaw = originalExecuteRaw;
    enableEngineFlags();
  }
});

test("bookAppointmentViaNatalie uses calendar engine when engine ON", async () => {
  enableEngineFlags();
  const workCases = new Map<string, Record<string, unknown>>();
  const events = new Map<string, Record<string, unknown>>();
  const timeline: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const decisions = new Map<string, Record<string, unknown>>();
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const originals = {
    transaction: prisma.$transaction.bind(prisma),
    organizationFindFirst: prisma.organization.findFirst.bind(prisma.organization),
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    clientFindMany: prisma.client.findMany.bind(prisma.client),
    clientFindFirst: prisma.client.findFirst.bind(prisma.client),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    workCaseCreate: prisma.workCase.create.bind(prisma.workCase),
    workCaseFindFirst: prisma.workCase.findFirst.bind(prisma.workCase),
    calendarEventCreate: prisma.calendarEvent.create.bind(prisma.calendarEvent),
    calendarEventFindFirst: prisma.calendarEvent.findFirst.bind(prisma.calendarEvent),
    calendarEventUpdate: prisma.calendarEvent.update.bind(prisma.calendarEvent),
    timelineCreate: prisma.workCaseTimelineEntry.create.bind(prisma.workCaseTimelineEntry),
    auditCreate: prisma.calendarEventAudit.create.bind(prisma.calendarEventAudit),
    decisionCreate: prisma.ownerDecisionQueueItem.create.bind(prisma.ownerDecisionQueueItem),
    decisionFindFirst: prisma.ownerDecisionQueueItem.findFirst.bind(prisma.ownerDecisionQueueItem),
    serviceFindFirst: prisma.service.findFirst.bind(prisma.service),
  };

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.organization.findFirst = (async () => ({
    calendarAutonomyJson: {
      calendarAutonomy: { autoConfirmWhenFullyReady: false, autoCreateFollowUpTask: false },
    },
  })) as typeof prisma.organization.findFirst;
  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: true,
  })) as typeof prisma.organization.findUnique;
  prisma.client.findMany = (async () => [{ id: CLIENT_ID, name: "לקוח בדיקה", whatsappNumber: null, email: "client@example.com", emailIsPlaceholder: false }]) as typeof prisma.client.findMany;
  prisma.client.findFirst = (async (args) => {
    const id = args?.where?.id as string | undefined;
    const orgId = args?.where?.organizationId as string | undefined;
    if (id === CLIENT_ID && orgId === ORG) {
      return { id: CLIENT_ID, organizationId: ORG, isActive: true };
    }
    return null;
  }) as typeof prisma.client.findFirst;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  prisma.service.findFirst = (async () => null) as typeof prisma.service.findFirst;

  prisma.workCase.create = (async (args) => {
    const id = nextId("wc");
    const row = { id, organizationId: args.data.organizationId, title: args.data.title, status: "open" };
    workCases.set(id, row);
    return { ...row, client: null, lead: null, assignedUser: null };
  }) as typeof prisma.workCase.create;

  prisma.workCase.findFirst = (async (args) => {
    const row = workCases.get(args?.where?.id as string);
    return row ? { ...row, client: null, lead: null, assignedUser: null } : null;
  }) as typeof prisma.workCase.findFirst;

  prisma.calendarEvent.create = (async (args) => {
    const id = nextId("evt");
    const row = {
      id,
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId,
      status: args.data.status ?? "draft",
      title: args.data.title ?? null,
      startAt: args.data.startAt,
      endAt: args.data.endAt,
      clientId: args.data.clientId ?? null,
      serviceId: args.data.serviceId ?? null,
      assignedUserId: null,
      prerequisitesJson: args.data.prerequisitesJson ?? [],
    };
    events.set(id, row);
    return {
      ...row,
      client: { id: CLIENT_ID, name: "לקוח בדיקה" },
      service: null,
      workCase: { id: row.workCaseId, title: "תיק", status: "open" },
    };
  }) as typeof prisma.calendarEvent.create;

  prisma.calendarEvent.findFirst = (async (args) => {
    const id = args?.where?.id as string | undefined;
    const row = id ? events.get(id) : [...events.values()].find((e) => e.organizationId === args?.where?.organizationId);
    if (!row) return null;
    return {
      ...row,
      client: { id: CLIENT_ID, name: "לקוח בדיקה" },
      service: null,
      workCase: { id: row.workCaseId, title: "תיק", status: "open" },
    };
  }) as typeof prisma.calendarEvent.findFirst;

  prisma.calendarEvent.update = (async (args) => {
    const row = events.get(args.where.id)!;
    Object.assign(row, args.data);
    return {
      ...row,
      client: { id: CLIENT_ID, name: "לקוח בדיקה" },
      service: null,
      workCase: { id: row.workCaseId, title: "תיק", status: "open" },
    };
  }) as typeof prisma.calendarEvent.update;

  prisma.workCaseTimelineEntry.create = (async (args) => {
    timeline.push({ type: args.data.type });
    return { id: nextId("tl"), ...args.data, createdAt: new Date() };
  }) as typeof prisma.workCaseTimelineEntry.create;

  prisma.calendarEventAudit.create = (async (args) => {
    audits.push({ action: args.data.action });
    return { id: nextId("audit"), ...args.data, createdAt: new Date() };
  }) as typeof prisma.calendarEventAudit.create;

  prisma.ownerDecisionQueueItem.create = (async (args) => {
    const id = nextId("dec");
    const row = { id, ...args.data, status: "pending" };
    decisions.set(id, row);
    return {
      ...row,
      workCase: { id: args.data.workCaseId, title: "תיק" },
      calendarEvent: events.get(args.data.calendarEventId as string) ?? null,
    };
  }) as typeof prisma.ownerDecisionQueueItem.create;

  prisma.ownerDecisionQueueItem.findFirst = (async () => null) as typeof prisma.ownerDecisionQueueItem.findFirst;

  const restore = () => {
    prisma.$transaction = originals.transaction;
    prisma.organization.findFirst = originals.organizationFindFirst;
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.client.findMany = originals.clientFindMany;
    prisma.client.findFirst = originals.clientFindFirst;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.service.findFirst = originals.serviceFindFirst;
    prisma.workCase.create = originals.workCaseCreate;
    prisma.workCase.findFirst = originals.workCaseFindFirst;
    prisma.calendarEvent.create = originals.calendarEventCreate;
    prisma.calendarEvent.findFirst = originals.calendarEventFindFirst;
    prisma.calendarEvent.update = originals.calendarEventUpdate;
    prisma.workCaseTimelineEntry.create = originals.timelineCreate;
    prisma.calendarEventAudit.create = originals.auditCreate;
    prisma.ownerDecisionQueueItem.create = originals.decisionCreate;
    prisma.ownerDecisionQueueItem.findFirst = originals.decisionFindFirst;
  };

  try {
    const result = await bookAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      clientName: "לקוח בדיקה",
      startTime: "2026-12-01T10:00:00.000Z",
      durationMinutes: 30,
    });
    assert.equal(result.engine, true);
    assert.equal(result.pendingApproval, true);
    assert.ok(result.decisionId);
    assert.match(result.message, /אישור/);
    assert.ok(decisions.size >= 1);
  } finally {
    restore();
  }
});

test("cancelAppointmentViaNatalie creates owner decision when engine ON", async () => {
  enableEngineFlags();
  const events = new Map<string, Record<string, unknown>>();
  const decisions = new Map<string, Record<string, unknown>>();
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const originals = {
    transaction: prisma.$transaction.bind(prisma),
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    calendarEventFindFirst: prisma.calendarEvent.findFirst.bind(prisma.calendarEvent),
    workCaseFindFirst: prisma.workCase.findFirst.bind(prisma.workCase),
    decisionCreate: prisma.ownerDecisionQueueItem.create.bind(prisma.ownerDecisionQueueItem),
    decisionFindFirst: prisma.ownerDecisionQueueItem.findFirst.bind(prisma.ownerDecisionQueueItem),
    appointmentFindFirst: prisma.appointment.findFirst.bind(prisma.appointment),
    timelineCreate: prisma.workCaseTimelineEntry.create.bind(prisma.workCaseTimelineEntry),
  };

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.organization.findUnique = (async () => ({
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: true,
  })) as typeof prisma.organization.findUnique;

  events.set("evt-confirmed", {
    id: "evt-confirmed",
    organizationId: ORG,
    status: "confirmed",
    workCaseId: "wc-1",
    title: "תור",
  });

  prisma.workCase.findFirst = (async () => ({
    id: "wc-1",
    organizationId: ORG,
    title: "תיק",
    status: "open",
  })) as typeof prisma.workCase.findFirst;

  prisma.workCaseTimelineEntry.create = (async (args) => ({
    id: nextId("tl"),
    ...args.data,
    createdAt: new Date(),
  })) as typeof prisma.workCaseTimelineEntry.create;

  prisma.calendarEvent.findFirst = (async (args) => {
    const row = events.get(args?.where?.id as string);
    if (!row || row.organizationId !== args?.where?.organizationId) return null;
    return row;
  }) as typeof prisma.calendarEvent.findFirst;

  prisma.ownerDecisionQueueItem.findFirst = (async () => null) as typeof prisma.ownerDecisionQueueItem.findFirst;

  prisma.ownerDecisionQueueItem.create = (async (args) => {
    const id = nextId("dec");
    decisions.set(id, { id, type: args.data.type, status: "pending" });
    return {
      id,
      ...args.data,
      status: "pending",
      workCase: { id: args.data.workCaseId, title: "תיק" },
      calendarEvent: events.get(args.data.calendarEventId as string),
    };
  }) as typeof prisma.ownerDecisionQueueItem.create;

  try {
    const result = await cancelAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      schedulingItemId: "evt-confirmed",
    });
    assert.equal(result.engine, true);
    assert.equal(result.pendingApproval, true);
    assert.equal(result.queueType, "cancel_appointment");
  } finally {
    prisma.$transaction = originals.transaction;
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.calendarEvent.findFirst = originals.calendarEventFindFirst;
    prisma.workCase.findFirst = originals.workCaseFindFirst;
    prisma.ownerDecisionQueueItem.create = originals.decisionCreate;
    prisma.ownerDecisionQueueItem.findFirst = originals.decisionFindFirst;
    prisma.appointment.findFirst = originals.appointmentFindFirst;
    prisma.workCaseTimelineEntry.create = originals.timelineCreate;
  }
});

test("rescheduleAppointmentViaNatalie creates owner decision when engine ON", async () => {
  enableEngineFlags();
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const originals = {
    transaction: prisma.$transaction.bind(prisma),
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    calendarEventFindFirst: prisma.calendarEvent.findFirst.bind(prisma.calendarEvent),
    workCaseFindFirst: prisma.workCase.findFirst.bind(prisma.workCase),
    decisionCreate: prisma.ownerDecisionQueueItem.create.bind(prisma.ownerDecisionQueueItem),
    decisionFindFirst: prisma.ownerDecisionQueueItem.findFirst.bind(prisma.ownerDecisionQueueItem),
    serviceFindFirst: prisma.service.findFirst.bind(prisma.service),
    timelineCreate: prisma.workCaseTimelineEntry.create.bind(prisma.workCaseTimelineEntry),
  };

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.organization.findUnique = (async () => ({
    timezone: "UTC",
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: true,
    calendarEngineGoogleMirrorEnabled: true,
  })) as typeof prisma.organization.findUnique;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  prisma.service.findFirst = (async () => null) as typeof prisma.service.findFirst;
  prisma.ownerDecisionQueueItem.findFirst = (async () => null) as typeof prisma.ownerDecisionQueueItem.findFirst;

  prisma.workCase.findFirst = (async () => ({
    id: "wc-1",
    organizationId: ORG,
    title: "תיק",
    status: "open",
  })) as typeof prisma.workCase.findFirst;

  prisma.workCaseTimelineEntry.create = (async (args) => ({
    id: nextId("tl"),
    ...args.data,
    createdAt: new Date(),
  })) as typeof prisma.workCaseTimelineEntry.create;

  prisma.calendarEvent.findFirst = (async (args) => {
    const where = args?.where as Record<string, unknown> | undefined;
    const id = where?.id;
    if (typeof id === "object" && id && "not" in id) {
      return null;
    }
    if (id !== "evt-confirmed") {
      return null;
    }
    return {
      id: "evt-confirmed",
      organizationId: ORG,
      status: "confirmed",
      workCaseId: "wc-1",
      title: "תור",
      startAt: at("2026-12-01T10:00:00.000Z"),
      endAt: at("2026-12-01T11:00:00.000Z"),
      serviceId: null,
      assignedUserId: null,
    };
  }) as typeof prisma.calendarEvent.findFirst;

  let createdType = "";
  prisma.ownerDecisionQueueItem.create = (async (args) => {
    createdType = String(args.data.type);
    return {
      id: "dec-reschedule",
      ...args.data,
      status: "pending",
      workCase: { id: "wc-1", title: "תיק" },
      calendarEvent: null,
    };
  }) as typeof prisma.ownerDecisionQueueItem.create;

  try {
    const result = await rescheduleAppointmentViaNatalie({
      organizationId: ORG,
      userId: USER,
      schedulingItemId: "evt-confirmed",
      newStartTime: "2026-12-02T10:00:00.000Z",
    });
    assert.equal(result.engine, true);
    assert.equal(result.queueType, "reschedule_appointment");
    assert.equal(createdType, "reschedule_appointment");
  } finally {
    prisma.$transaction = originals.transaction;
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.calendarEvent.findFirst = originals.calendarEventFindFirst;
    prisma.workCase.findFirst = originals.workCaseFindFirst;
    prisma.ownerDecisionQueueItem.create = originals.decisionCreate;
    prisma.ownerDecisionQueueItem.findFirst = originals.decisionFindFirst;
    prisma.service.findFirst = originals.serviceFindFirst;
    prisma.workCaseTimelineEntry.create = originals.timelineCreate;
  }
});
