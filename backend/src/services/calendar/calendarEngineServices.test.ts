import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  approveDecisionQueueItem,
  createPendingDecision,
  getDecisionQueueItemById,
} from "./decisionQueueService.js";
import {
  createDraftCalendarEvent,
  getCalendarEventById,
  requestCalendarEventCancel,
  requestCalendarEventReschedule,
  completeCalendarEvent,
  markCalendarEventNoShow,
  submitCalendarEventForConfirmation,
  transitionCalendarEventStatus,
} from "./calendarEventService.js";
import { getWorkCaseById } from "./workCaseService.js";
import { CalendarEngineDisabledError } from "./calendarEngineFlags.js";

const ORG_A = "org-calendar-a";
const ORG_B = "org-calendar-b";
const CLIENT_ID = "client-1";
const ACTOR = { actorType: "user" as const, actorUserId: "user-1" };

type WorkCaseRow = {
  id: string;
  organizationId: string;
  title: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  clientId: string | null;
  leadId: string | null;
  assignedUserId: string | null;
  source: string;
  invoiceDraftRequested: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type CalendarEventRow = {
  id: string;
  organizationId: string;
  workCaseId: string;
  status: string;
  eventType: string;
  title: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  clientId: string | null;
  leadId: string | null;
  assignedUserId: string | null;
  serviceId: string | null;
  source: string;
  prerequisitesJson: unknown;
  completionNotes: string | null;
  completionOutcome: string | null;
  createdByUserId: string | null;
  rescheduledFromId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TimelineRow = {
  id: string;
  organizationId: string;
  workCaseId: string;
  calendarEventId: string | null;
  type: string;
  summary: string;
  actorType: string;
  actorUserId: string | null;
  metaJson: unknown;
  createdAt: Date;
};

type AuditRow = {
  id: string;
  calendarEventId: string;
  organizationId: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  changesJson: unknown;
  createdAt: Date;
};

type DecisionRow = {
  id: string;
  organizationId: string;
  workCaseId: string;
  calendarEventId: string | null;
  type: string;
  status: string;
  title: string;
  reason: string | null;
  preparedPayloadJson: unknown;
  source: string;
  executionIdempotencyKey: string | null;
  metaJson: unknown;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TaskRow = {
  id: string;
  organizationId: string;
  workCaseId: string | null;
  calendarEventId: string | null;
  clientId: string | null;
  title: string;
  source: string;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
};

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function at(iso: string) {
  return new Date(iso);
}

function createStore() {
  const workCases = new Map<string, WorkCaseRow>();
  const events = new Map<string, CalendarEventRow>();
  const timeline: TimelineRow[] = [];
  const audits: AuditRow[] = [];
  const decisions = new Map<string, DecisionRow>();
  const tasks: TaskRow[] = [];
  const organizations = new Map<
    string,
    {
      calendarAutonomyJson: unknown;
      calendarEngineReadEnabled?: boolean;
      calendarEngineWriteEnabled?: boolean;
      calendarEngineGoogleMirrorEnabled?: boolean;
    }
  >([
    [
      ORG_A,
      {
        calendarEngineReadEnabled: true,
        calendarEngineWriteEnabled: true,
        calendarEngineGoogleMirrorEnabled: true,
        calendarAutonomyJson: {
          calendarAutonomy: {
            autoConfirmWhenFullyReady: false,
            autoSendFollowUp: false,
            autoSyncGoogleOnConfirm: true,
            autoCreateFollowUpTask: true,
          },
        },
      },
    ],
    [ORG_B, { calendarAutonomyJson: {}, calendarEngineReadEnabled: true, calendarEngineWriteEnabled: false }],
  ]);

  return { workCases, events, timeline, audits, decisions, tasks, organizations };
}

function installPrismaMocks(store: ReturnType<typeof createStore>) {
  const originals = {
    transaction: prisma.$transaction.bind(prisma),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    organizationFindFirst: prisma.organization.findFirst.bind(prisma.organization),
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    workCaseCreate: prisma.workCase.create.bind(prisma.workCase),
    workCaseFindFirst: prisma.workCase.findFirst.bind(prisma.workCase),
    workCaseUpdate: prisma.workCase.update.bind(prisma.workCase),
    calendarEventCreate: prisma.calendarEvent.create.bind(prisma.calendarEvent),
    calendarEventFindFirst: prisma.calendarEvent.findFirst.bind(prisma.calendarEvent),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    calendarEventUpdate: prisma.calendarEvent.update.bind(prisma.calendarEvent),
    timelineCreate: prisma.workCaseTimelineEntry.create.bind(prisma.workCaseTimelineEntry),
    auditCreate: prisma.calendarEventAudit.create.bind(prisma.calendarEventAudit),
    decisionCreate: prisma.ownerDecisionQueueItem.create.bind(prisma.ownerDecisionQueueItem),
    decisionFindFirst: prisma.ownerDecisionQueueItem.findFirst.bind(prisma.ownerDecisionQueueItem),
    decisionUpdate: prisma.ownerDecisionQueueItem.update.bind(prisma.ownerDecisionQueueItem),
    taskCreate: prisma.task.create.bind(prisma.task),
    taskCount: prisma.task.count.bind(prisma.task),
  };

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;

  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;

  prisma.organization.findFirst = (async (args) => {
    const orgId = args?.where?.id as string | undefined;
    if (!orgId || !store.organizations.has(orgId)) return null;
    return { calendarAutonomyJson: store.organizations.get(orgId)!.calendarAutonomyJson };
  }) as typeof prisma.organization.findFirst;

  prisma.organization.findUnique = (async (args) => {
    const orgId = args?.where?.id as string | undefined;
    if (!orgId || !store.organizations.has(orgId)) return null;
    const org = store.organizations.get(orgId)!;
    return {
      calendarEngineReadEnabled: org.calendarEngineReadEnabled ?? false,
      calendarEngineWriteEnabled: org.calendarEngineWriteEnabled ?? false,
      calendarEngineGoogleMirrorEnabled: org.calendarEngineGoogleMirrorEnabled ?? false,
    };
  }) as typeof prisma.organization.findUnique;

  prisma.workCase.create = (async (args) => {
    const id = nextId("wc");
    const row: WorkCaseRow = {
      id,
      organizationId: args.data.organizationId,
      title: args.data.title,
      status: (args.data.status as WorkCaseRow["status"]) ?? "open",
      clientId: args.data.clientId ?? null,
      leadId: args.data.leadId ?? null,
      assignedUserId: args.data.assignedUserId ?? null,
      source: args.data.source ?? "calendar",
      invoiceDraftRequested: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.workCases.set(id, row);
    return { ...row, client: null, lead: null, assignedUser: null };
  }) as typeof prisma.workCase.create;

  prisma.workCase.findFirst = (async (args) => {
    const where = args?.where ?? {};
    const row = [...store.workCases.values()].find((item) => {
      if (where.id && item.id !== where.id) return false;
      if (where.organizationId && item.organizationId !== where.organizationId) return false;
      return true;
    });
    if (!row) return null;
    return {
      ...row,
      client: row.clientId ? { id: row.clientId, name: "Client" } : null,
      lead: null,
      assignedUser: null,
    };
  }) as typeof prisma.workCase.findFirst;

  prisma.workCase.update = (async (args) => {
    const row = store.workCases.get(args.where.id)!;
    Object.assign(row, args.data, { updatedAt: new Date() });
    return {
      ...row,
      client: row.clientId ? { id: row.clientId, name: "Client" } : null,
      lead: null,
      assignedUser: null,
    };
  }) as typeof prisma.workCase.update;

  prisma.calendarEvent.create = (async (args) => {
    const id = nextId("evt");
    const row: CalendarEventRow = {
      id,
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId,
      status: String(args.data.status ?? "draft"),
      eventType: String(args.data.eventType ?? "appointment"),
      title: args.data.title ?? null,
      startAt: args.data.startAt as Date,
      endAt: args.data.endAt as Date,
      timezone: String(args.data.timezone ?? "Asia/Jerusalem"),
      clientId: args.data.clientId ?? null,
      leadId: args.data.leadId ?? null,
      assignedUserId: args.data.assignedUserId ?? null,
      serviceId: args.data.serviceId ?? null,
      source: String(args.data.source),
      prerequisitesJson: args.data.prerequisitesJson ?? [],
      completionNotes: null,
      completionOutcome: null,
      createdByUserId: args.data.createdByUserId ?? null,
      rescheduledFromId: args.data.rescheduledFromId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.events.set(id, row);
    return {
      ...row,
      client: row.clientId ? { id: row.clientId, name: "Client" } : null,
      service: null,
      workCase: store.workCases.get(row.workCaseId)
        ? {
            id: row.workCaseId,
            title: store.workCases.get(row.workCaseId)!.title,
            status: store.workCases.get(row.workCaseId)!.status,
          }
        : null,
    };
  }) as typeof prisma.calendarEvent.create;

  prisma.calendarEvent.findFirst = (async (args) => {
    const where = args?.where ?? {};
    const row = [...store.events.values()].find((item) => {
      if (where.id && item.id !== where.id) return false;
      if (where.organizationId && item.organizationId !== where.organizationId) return false;
      if (where.workCaseId && item.workCaseId !== where.workCaseId) return false;
      return true;
    });
    if (!row) return null;
    return {
      ...row,
      client: row.clientId ? { id: row.clientId, name: "Client" } : null,
      service: null,
      workCase: {
        id: row.workCaseId,
        title: store.workCases.get(row.workCaseId)?.title ?? "Work Case",
        status: store.workCases.get(row.workCaseId)?.status ?? "open",
      },
    };
  }) as typeof prisma.calendarEvent.findFirst;

  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where ?? {};
    return [...store.events.values()]
      .filter((item) => {
        if (where.organizationId && item.organizationId !== where.organizationId) return false;
        if (where.status && typeof where.status === "object" && "in" in where.status) {
          const allowed = where.status.in as string[];
          if (!allowed.includes(item.status)) return false;
        }
        if (where.id && typeof where.id === "object" && "not" in where.id) {
          if (item.id === where.id.not) return false;
        }
        if (where.startAt && typeof where.startAt === "object" && "lt" in where.startAt) {
          if (!(item.startAt < (where.startAt.lt as Date))) return false;
        }
        return true;
      })
      .map((item) => ({
        id: item.id,
        startAt: item.startAt,
        endAt: item.endAt,
        client: { name: "Client" },
        service: null,
      }));
  }) as typeof prisma.calendarEvent.findMany;

  prisma.calendarEvent.update = (async (args) => {
    const row = store.events.get(args.where.id)!;
    Object.assign(row, args.data, { updatedAt: new Date() });
    return {
      ...row,
      client: row.clientId ? { id: row.clientId, name: "Client" } : null,
      service: null,
      workCase: {
        id: row.workCaseId,
        title: store.workCases.get(row.workCaseId)?.title ?? "Work Case",
        status: store.workCases.get(row.workCaseId)?.status ?? "open",
      },
    };
  }) as typeof prisma.calendarEvent.update;

  prisma.workCaseTimelineEntry.create = (async (args) => {
    const row: TimelineRow = {
      id: nextId("tl"),
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId,
      calendarEventId: args.data.calendarEventId ?? null,
      type: String(args.data.type),
      summary: args.data.summary,
      actorType: String(args.data.actorType),
      actorUserId: args.data.actorUserId ?? null,
      metaJson: args.data.metaJson ?? null,
      createdAt: new Date(),
    };
    store.timeline.push(row);
    return row;
  }) as typeof prisma.workCaseTimelineEntry.create;

  prisma.calendarEventAudit.create = (async (args) => {
    const row: AuditRow = {
      id: nextId("audit"),
      calendarEventId: args.data.calendarEventId,
      organizationId: args.data.organizationId,
      action: args.data.action,
      actorType: String(args.data.actorType),
      actorUserId: args.data.actorUserId ?? null,
      fromStatus: args.data.fromStatus ?? null,
      toStatus: args.data.toStatus ?? null,
      changesJson: args.data.changesJson ?? null,
      createdAt: new Date(),
    };
    store.audits.push(row);
    return row;
  }) as typeof prisma.calendarEventAudit.create;

  prisma.ownerDecisionQueueItem.create = (async (args) => {
    const id = nextId("dec");
    const row: DecisionRow = {
      id,
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId,
      calendarEventId: args.data.calendarEventId ?? null,
      type: String(args.data.type),
      status: String(args.data.status ?? "pending"),
      title: args.data.title,
      reason: args.data.reason ?? null,
      preparedPayloadJson: args.data.preparedPayloadJson ?? null,
      source: String(args.data.source),
      executionIdempotencyKey: null,
      metaJson: null,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.decisions.set(id, row);
    return {
      ...row,
      workCase: { id: row.workCaseId, title: store.workCases.get(row.workCaseId)?.title ?? "Work Case" },
      calendarEvent: row.calendarEventId ? store.events.get(row.calendarEventId) ?? null : null,
    };
  }) as typeof prisma.ownerDecisionQueueItem.create;

  prisma.ownerDecisionQueueItem.findFirst = (async (args) => {
    const where = args?.where ?? {};
    const row = [...store.decisions.values()].find((item) => {
      if (where.id && item.id !== where.id) return false;
      if (where.organizationId && item.organizationId !== where.organizationId) return false;
      return true;
    });
    if (!row) return null;
    const event = row.calendarEventId ? store.events.get(row.calendarEventId) : null;
    return {
      ...row,
      workCase: { id: row.workCaseId, title: store.workCases.get(row.workCaseId)?.title ?? "Work Case" },
      calendarEvent: event
        ? {
            id: event.id,
            status: event.status,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            assignedUserId: event.assignedUserId,
          }
        : null,
    };
  }) as typeof prisma.ownerDecisionQueueItem.findFirst;

  prisma.ownerDecisionQueueItem.update = (async (args) => {
    const row = store.decisions.get(args.where.id)!;
    Object.assign(row, args.data, { updatedAt: new Date() });
    const event = row.calendarEventId ? store.events.get(row.calendarEventId) : null;
    return {
      ...row,
      workCase: { id: row.workCaseId, title: store.workCases.get(row.workCaseId)?.title ?? "Work Case" },
      calendarEvent: event
        ? {
            id: event.id,
            status: event.status,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            assignedUserId: event.assignedUserId,
          }
        : null,
    };
  }) as typeof prisma.ownerDecisionQueueItem.update;

  prisma.task.create = (async (args) => {
    const row: TaskRow = {
      id: nextId("task"),
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId ?? null,
      calendarEventId: args.data.calendarEventId ?? null,
      clientId: args.data.clientId ?? null,
      title: args.data.title,
      source: args.data.source ?? "manual",
      status: args.data.status ?? "open",
      priority: args.data.priority ?? "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.tasks.push(row);
    return row;
  }) as typeof prisma.task.create;

  prisma.task.count = (async () => 0) as typeof prisma.task.count;

  return () => {
    prisma.$transaction = originals.transaction;
    prisma.appointment.findMany = originals.appointmentFindMany;
    prisma.organization.findFirst = originals.organizationFindFirst;
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.workCase.create = originals.workCaseCreate;
    prisma.workCase.findFirst = originals.workCaseFindFirst;
    prisma.workCase.update = originals.workCaseUpdate;
    prisma.calendarEvent.create = originals.calendarEventCreate;
    prisma.calendarEvent.findFirst = originals.calendarEventFindFirst;
    prisma.calendarEvent.findMany = originals.calendarEventFindMany;
    prisma.calendarEvent.update = originals.calendarEventUpdate;
    prisma.workCaseTimelineEntry.create = originals.timelineCreate;
    prisma.calendarEventAudit.create = originals.auditCreate;
    prisma.ownerDecisionQueueItem.create = originals.decisionCreate;
    prisma.ownerDecisionQueueItem.findFirst = originals.decisionFindFirst;
    prisma.ownerDecisionQueueItem.update = originals.decisionUpdate;
    prisma.task.create = originals.taskCreate;
    prisma.task.count = originals.taskCount;
  };
}

function enableCalendarEngineFlags() {
  process.env.CALENDAR_ENGINE_V1_READ = "true";
  process.env.CALENDAR_ENGINE_V1_WRITE = "true";
}

function disableCalendarEngineFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

test("calendar engine write is blocked when feature flag is disabled", async () => {
  disableCalendarEngineFlags();
  try {
    await assert.rejects(
      () =>
        createDraftCalendarEvent(
          ORG_A,
          {
            startAt: at("2026-06-25T10:00:00.000Z"),
            endAt: at("2026-06-25T11:00:00.000Z"),
            clientId: CLIENT_ID,
            source: "manual",
          },
          ACTOR
        ),
      (err: unknown) => err instanceof CalendarEngineDisabledError
    );
  } finally {
    enableCalendarEngineFlags();
  }
});

test("getWorkCaseById enforces organization isolation", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);
  store.workCases.set("wc-1", {
    id: "wc-1",
    organizationId: ORG_A,
    title: "Private",
    status: "open",
    clientId: null,
    leadId: null,
    assignedUserId: null,
    source: "calendar",
    invoiceDraftRequested: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await assert.rejects(() => getWorkCaseById(ORG_B, "wc-1"), /WorkCase not found/);
    const found = await getWorkCaseById(ORG_A, "wc-1");
    assert.equal(found.id, "wc-1");
  } finally {
    restore();
  }
});

test("create draft event writes timeline and audit entries", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      },
      ACTOR
    );

    assert.equal(event.status, "draft");
    assert.ok(store.timeline.some((entry) => entry.type === "work_case_created"));
    assert.ok(store.timeline.some((entry) => entry.type === "event_created"));
    assert.equal(store.audits.length, 1);
    assert.equal(store.audits[0]?.action, "created");
  } finally {
    restore();
  }
});

test("submit for confirmation queues confirm_appointment by default", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      },
      ACTOR
    );

    const result = await submitCalendarEventForConfirmation(ORG_A, event.id, ACTOR);
    assert.equal(result.mode, "queued");
    if (result.mode === "queued") {
      assert.equal(result.queueType, "confirm_appointment");
      const decision = await getDecisionQueueItemById(ORG_A, result.decisionId);
      assert.equal(decision.status, "pending");
    }
    assert.ok(store.timeline.some((entry) => entry.type === "approval_requested"));
  } finally {
    restore();
  }
});

test("approve confirm decision transitions event to confirmed", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      },
      ACTOR
    );

    const queued = await submitCalendarEventForConfirmation(ORG_A, event.id, ACTOR);
    assert.equal(queued.mode, "queued");

    if (queued.mode === "queued") {
      await approveDecisionQueueItem(ORG_A, queued.decisionId, ACTOR);
      const confirmed = await getCalendarEventById(ORG_A, event.id);
      assert.equal(confirmed.status, "confirmed");
      assert.ok(store.timeline.some((entry) => entry.type === "approval_granted"));
      assert.ok(store.audits.some((entry) => entry.action === "status_changed"));
    }
  } finally {
    restore();
  }
});

test("conflict during confirmation creates override_conflict queue item", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  const originalAppointmentFindMany = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-conflict",
      startTime: at("2026-06-25T10:30:00.000Z"),
      durationMinutes: 60,
      client: { name: "Existing Client" },
      service: { name: "Service" },
    },
  ]) as typeof prisma.appointment.findMany;

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      },
      ACTOR
    );

    const result = await submitCalendarEventForConfirmation(ORG_A, event.id, ACTOR);
    assert.equal(result.mode, "queued");
    if (result.mode === "queued") {
      assert.equal(result.queueType, "override_conflict");
    }
  } finally {
    prisma.appointment.findMany = originalAppointmentFindMany;
    restore();
  }
});

test("complete event creates follow-up task and timeline entry", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-20T10:00:00.000Z"),
        endAt: at("2026-06-20T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR, {
      now: at("2026-06-20T09:00:00.000Z"),
    });

    await transitionCalendarEventStatus(ORG_A, event.id, "completed", ACTOR, {
      now: at("2026-06-20T12:00:00.000Z"),
      completionNotes: "Great session",
      completionOutcome: "completed_success",
    });

    assert.equal(store.tasks.length, 1);
    assert.equal(store.tasks[0]?.source, "post_event");
    assert.ok(store.timeline.some((entry) => entry.type === "task_spawned"));
  } finally {
    restore();
  }
});

test("invoice placeholder approval only sets WorkCase flag", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    const decision = await createPendingDecision({
      organizationId: ORG_A,
      workCaseId: event.workCaseId,
      calendarEventId: event.id,
      type: "create_invoice_placeholder",
      title: "Invoice draft",
      source: "manual",
      actor: ACTOR,
    });

    await approveDecisionQueueItem(ORG_A, decision.id, ACTOR);
    const workCase = await getWorkCaseById(ORG_A, event.workCaseId);
    assert.equal(workCase.invoiceDraftRequested, true);
    assert.ok(store.timeline.some((entry) => entry.type === "invoice_requested"));
  } finally {
    restore();
  }
});

test("event mutations write audit rows", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    assert.ok(store.audits.some((entry) => entry.action === "status_changed"));
  } finally {
    restore();
  }
});

test("request cancel creates cancel_appointment decision without changing event status", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR);

    const result = await requestCalendarEventCancel(ORG_A, event.id, ACTOR);
    assert.equal(result.queueType, "cancel_appointment");

    const refreshed = await getCalendarEventById(ORG_A, event.id);
    assert.equal(refreshed.status, "confirmed");
    const decision = await getDecisionQueueItemById(ORG_A, result.decisionId);
    assert.equal(decision.status, "pending");
    assert.equal(decision.type, "cancel_appointment");
    assert.ok(store.timeline.some((entry) => entry.type === "approval_requested"));
  } finally {
    restore();
  }
});

test("request reschedule creates reschedule_appointment decision with payload", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR);

    const result = await requestCalendarEventReschedule(
      ORG_A,
      event.id,
      {
        startAt: at("2026-06-26T12:00:00.000Z"),
        endAt: at("2026-06-26T13:00:00.000Z"),
      },
      ACTOR
    );
    assert.equal(result.queueType, "reschedule_appointment");

    const decision = await getDecisionQueueItemById(ORG_A, result.decisionId);
    const payload = decision.preparedPayloadJson as Record<string, unknown>;
    assert.equal(typeof payload.startAt, "string");
    assert.equal(typeof payload.endAt, "string");
  } finally {
    restore();
  }
});

test("approve cancel transitions event to cancelled", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR);

    const queued = await requestCalendarEventCancel(ORG_A, event.id, ACTOR);
    await approveDecisionQueueItem(ORG_A, queued.decisionId, ACTOR);

    const cancelled = await getCalendarEventById(ORG_A, event.id);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(store.timeline.some((entry) => entry.type === "event_cancelled"));
  } finally {
    restore();
  }
});

test("approve reschedule links old/new events and marks old rescheduled", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR);

    const queued = await requestCalendarEventReschedule(
      ORG_A,
      event.id,
      {
        startAt: at("2026-06-26T12:00:00.000Z"),
        endAt: at("2026-06-26T13:00:00.000Z"),
      },
      ACTOR
    );
    const approveResult = await approveDecisionQueueItem(ORG_A, queued.decisionId, ACTOR);
    assert.equal(approveResult.executed, true);
    assert.equal(approveResult.result?.oldCalendarEventId, event.id);
    assert.ok(typeof approveResult.result?.newCalendarEventId === "string");

    const oldEvent = await getCalendarEventById(ORG_A, event.id);
    assert.equal(oldEvent.status, "rescheduled");

    const newEvent = await getCalendarEventById(ORG_A, String(approveResult.result?.newCalendarEventId));
    assert.equal(newEvent.status, "pending_readiness");
    assert.ok(store.timeline.some((entry) => entry.type === "event_rescheduled"));
  } finally {
    restore();
  }
});

test("reject cancel decision leaves event confirmed", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR);

    const queued = await requestCalendarEventCancel(ORG_A, event.id, ACTOR);
    const { rejectDecisionQueueItem } = await import("./decisionQueueService.js");
    await rejectDecisionQueueItem(ORG_A, queued.decisionId, ACTOR);

    const refreshed = await getCalendarEventById(ORG_A, event.id);
    assert.equal(refreshed.status, "confirmed");
    assert.ok(store.timeline.some((entry) => entry.type === "approval_rejected"));
  } finally {
    restore();
  }
});

test("completeCalendarEvent transitions confirmed event to completed", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-20T10:00:00.000Z"),
        endAt: at("2026-06-20T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR, {
      now: at("2026-06-20T09:00:00.000Z"),
    });

    const completed = await completeCalendarEvent(
      ORG_A,
      event.id,
      { completionNotes: "Great session", completionOutcome: "completed_success" },
      ACTOR,
      { now: at("2026-06-20T12:00:00.000Z") }
    );
    assert.equal(completed.status, "completed");
    assert.ok(store.timeline.some((entry) => entry.type === "event_completed"));
    assert.ok(store.audits.some((entry) => entry.action === "status_changed"));
  } finally {
    restore();
  }
});

test("completeCalendarEvent rejects missing notes", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-20T10:00:00.000Z"),
        endAt: at("2026-06-20T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR);

    await assert.rejects(
      () =>
        completeCalendarEvent(
          ORG_A,
          event.id,
          { completionNotes: "  ", completionOutcome: "completed_success" },
          ACTOR,
          { now: at("2026-06-20T12:00:00.000Z") }
        ),
      (err: Error) => err.message.includes("completionNotes")
    );
  } finally {
    restore();
  }
});

test("completeCalendarEvent rejects non-confirmed event", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await assert.rejects(
      () =>
        completeCalendarEvent(
          ORG_A,
          event.id,
          { completionNotes: "Notes", completionOutcome: "completed_success" },
          ACTOR
        ),
      (err: Error) => err.message.includes("Only confirmed")
    );
  } finally {
    restore();
  }
});

test("markCalendarEventNoShow transitions confirmed event to no_show", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-20T10:00:00.000Z"),
        endAt: at("2026-06-20T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR, {
      now: at("2026-06-20T09:00:00.000Z"),
    });

    const updated = await markCalendarEventNoShow(
      ORG_A,
      event.id,
      { notes: "Client did not arrive" },
      ACTOR,
      { now: at("2026-06-20T12:00:00.000Z") }
    );
    assert.equal(updated.status, "no_show");
    assert.ok(store.timeline.some((entry) => entry.type === "event_no_show"));
  } finally {
    restore();
  }
});

test("markCalendarEventNoShow rejects before start time", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-25T10:00:00.000Z"),
        endAt: at("2026-06-25T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR, {
      now: at("2026-06-25T09:00:00.000Z"),
    });

    await assert.rejects(
      () =>
        markCalendarEventNoShow(
          ORG_A,
          event.id,
          { notes: "Too early" },
          ACTOR,
          { now: at("2026-06-25T09:30:00.000Z") }
        ),
      (err: Error) => err.message.includes("no_show")
    );
  } finally {
    restore();
  }
});

test("completeCalendarEvent spawns follow-up task when autoCreateFollowUpTask is true", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-20T10:00:00.000Z"),
        endAt: at("2026-06-20T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR, {
      now: at("2026-06-20T09:00:00.000Z"),
    });

    await completeCalendarEvent(
      ORG_A,
      event.id,
      { completionNotes: "Done", completionOutcome: "completed_success" },
      ACTOR,
      { now: at("2026-06-20T12:00:00.000Z") }
    );

    assert.equal(store.tasks.length, 1);
    assert.equal(store.tasks[0]?.source, "post_event");
    assert.ok(store.timeline.some((entry) => entry.type === "task_spawned"));
  } finally {
    restore();
  }
});

test("completeCalendarEvent does not request invoice placeholder", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-20T10:00:00.000Z"),
        endAt: at("2026-06-20T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR, {
      now: at("2026-06-20T09:00:00.000Z"),
    });

    await completeCalendarEvent(
      ORG_A,
      event.id,
      { completionNotes: "Done", completionOutcome: "completed_success" },
      ACTOR,
      { now: at("2026-06-20T12:00:00.000Z") }
    );

    const workCase = [...store.workCases.values()].find((wc) => wc.id === event.workCaseId);
    assert.equal(workCase?.invoiceDraftRequested, false);
    assert.ok(!store.timeline.some((entry) => entry.type === "invoice_requested"));
  } finally {
    restore();
  }
});

test("markCalendarEventNoShow does not request invoice placeholder", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);

  try {
    const event = await createDraftCalendarEvent(
      ORG_A,
      {
        title: "Consultation",
        startAt: at("2026-06-20T10:00:00.000Z"),
        endAt: at("2026-06-20T11:00:00.000Z"),
        clientId: CLIENT_ID,
        source: "manual",
      },
      ACTOR
    );

    await transitionCalendarEventStatus(ORG_A, event.id, "pending_readiness", ACTOR);
    await transitionCalendarEventStatus(ORG_A, event.id, "confirmed", ACTOR, {
      now: at("2026-06-20T09:00:00.000Z"),
    });

    await markCalendarEventNoShow(
      ORG_A,
      event.id,
      { notes: "No show" },
      ACTOR,
      { now: at("2026-06-20T12:00:00.000Z") }
    );

    const workCase = [...store.workCases.values()].find((wc) => wc.id === event.workCaseId);
    assert.equal(workCase?.invoiceDraftRequested, false);
    assert.ok(!store.timeline.some((entry) => entry.type === "invoice_requested"));
  } finally {
    restore();
  }
});
