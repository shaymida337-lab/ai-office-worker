import express from "express";
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import type { JwtPayload } from "../lib/auth.js";
import { calendarEngineRouter } from "./calendarEngineRoutes.js";

const ORG_A = "org-api-a";
const ORG_B = "org-api-b";
const AUTH_A: JwtPayload = { organizationId: ORG_A, userId: "user-a", email: "a@example.com" };
const AUTH_B: JwtPayload = { organizationId: ORG_B, userId: "user-b", email: "b@example.com" };

type Store = ReturnType<typeof createStore>;

function createStore() {
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const workCases = new Map<string, Record<string, unknown>>();
  const events = new Map<string, Record<string, unknown>>();
  const timeline: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const decisions = new Map<string, Record<string, unknown>>();
  const tasks: Record<string, unknown>[] = [];

  return { workCases, events, timeline, audits, decisions, tasks, nextId };
}

function installMocks(store: Store) {
  const originals = {
    transaction: prisma.$transaction.bind(prisma),
    appointmentFindMany: prisma.appointment.findMany.bind(prisma.appointment),
    organizationFindFirst: prisma.organization.findFirst.bind(prisma.organization),
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    workCaseCreate: prisma.workCase.create.bind(prisma.workCase),
    workCaseFindMany: prisma.workCase.findMany.bind(prisma.workCase),
    workCaseFindFirst: prisma.workCase.findFirst.bind(prisma.workCase),
    workCaseUpdate: prisma.workCase.update.bind(prisma.workCase),
    calendarEventCreate: prisma.calendarEvent.create.bind(prisma.calendarEvent),
    calendarEventFindMany: prisma.calendarEvent.findMany.bind(prisma.calendarEvent),
    calendarEventFindFirst: prisma.calendarEvent.findFirst.bind(prisma.calendarEvent),
    calendarEventUpdate: prisma.calendarEvent.update.bind(prisma.calendarEvent),
    timelineCreate: prisma.workCaseTimelineEntry.create.bind(prisma.workCaseTimelineEntry),
    timelineFindMany: prisma.workCaseTimelineEntry.findMany.bind(prisma.workCaseTimelineEntry),
    auditCreate: prisma.calendarEventAudit.create.bind(prisma.calendarEventAudit),
    decisionCreate: prisma.ownerDecisionQueueItem.create.bind(prisma.ownerDecisionQueueItem),
    decisionFindMany: prisma.ownerDecisionQueueItem.findMany.bind(prisma.ownerDecisionQueueItem),
    decisionFindFirst: prisma.ownerDecisionQueueItem.findFirst.bind(prisma.ownerDecisionQueueItem),
    decisionUpdate: prisma.ownerDecisionQueueItem.update.bind(prisma.ownerDecisionQueueItem),
    taskCreate: prisma.task.create.bind(prisma.task),
    taskCount: prisma.task.count.bind(prisma.task),
  };

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as typeof prisma.$transaction;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.organization.findUnique = (async (args) => {
    const orgId = args?.where?.id as string | undefined;
    if (orgId !== ORG_A && orgId !== ORG_B) return null;
    return {
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
      timezone: "UTC",
      calendarAutonomyJson: {
        calendarAutonomy: {
          autoConfirmWhenFullyReady: false,
          autoSendFollowUp: false,
          autoSyncGoogleOnConfirm: true,
          autoCreateFollowUpTask: true,
        },
      },
    };
  }) as typeof prisma.organization.findUnique;
  prisma.organization.findFirst = (async (args) => {
    const orgId = args?.where?.id as string;
    if (orgId === ORG_A) {
      return {
        calendarAutonomyJson: {
          calendarAutonomy: {
            autoConfirmWhenFullyReady: false,
            autoSendFollowUp: false,
            autoSyncGoogleOnConfirm: true,
            autoCreateFollowUpTask: true,
          },
        },
      };
    }
    return { calendarAutonomyJson: {} };
  }) as typeof prisma.organization.findFirst;

  prisma.workCase.create = (async (args) => {
    const id = store.nextId("wc");
    const row = {
      id,
      organizationId: args.data.organizationId,
      title: args.data.title,
      status: args.data.status ?? "open",
      clientId: args.data.clientId ?? null,
      leadId: args.data.leadId ?? null,
      assignedUserId: args.data.assignedUserId ?? null,
      source: args.data.source ?? "calendar",
      invoiceDraftRequested: false,
      description: args.data.description ?? null,
      priority: args.data.priority ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      client: null,
      lead: null,
      assignedUser: null,
    };
    store.workCases.set(id, row);
    return row;
  }) as typeof prisma.workCase.create;

  prisma.workCase.findMany = (async (args) => {
    const orgId = args?.where?.organizationId;
    return [...store.workCases.values()].filter((row) => row.organizationId === orgId);
  }) as typeof prisma.workCase.findMany;

  prisma.workCase.findFirst = (async (args) => {
    const where = args?.where ?? {};
    return (
      [...store.workCases.values()].find((row) => {
        if (where.id && row.id !== where.id) return false;
        if (where.organizationId && row.organizationId !== where.organizationId) return false;
        return true;
      }) ?? null
    );
  }) as typeof prisma.workCase.findFirst;

  prisma.workCase.update = (async (args) => {
    const row = store.workCases.get(args.where.id)!;
    Object.assign(row, args.data, { updatedAt: new Date() });
    return row;
  }) as typeof prisma.workCase.update;

  prisma.calendarEvent.create = (async (args) => {
    const id = store.nextId("evt");
    const row = {
      id,
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId,
      status: args.data.status ?? "draft",
      eventType: args.data.eventType ?? "appointment",
      title: args.data.title ?? null,
      startAt: args.data.startAt,
      endAt: args.data.endAt,
      timezone: args.data.timezone ?? "Asia/Jerusalem",
      clientId: args.data.clientId ?? null,
      leadId: args.data.leadId ?? null,
      assignedUserId: args.data.assignedUserId ?? null,
      serviceId: args.data.serviceId ?? null,
      source: args.data.source,
      prerequisitesJson: args.data.prerequisitesJson ?? [],
      completionNotes: null,
      completionOutcome: null,
      createdByUserId: args.data.createdByUserId ?? null,
      rescheduledFromId: args.data.rescheduledFromId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      client: args.data.clientId ? { id: args.data.clientId, name: "Client" } : null,
      service: null,
      workCase: store.workCases.get(String(args.data.workCaseId)) ?? null,
    };
    store.events.set(id, row);
    return row;
  }) as typeof prisma.calendarEvent.create;

  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where ?? {};
    return [...store.events.values()].filter((row) => {
      if (where.organizationId && row.organizationId !== where.organizationId) return false;
      if (where.status && typeof where.status === "object" && "in" in where.status) {
        if (!(where.status.in as string[]).includes(String(row.status))) return false;
      }
      if (where.id && typeof where.id === "object" && "not" in where.id && row.id === where.id.not) return false;
      if (where.startAt && typeof where.startAt === "object") {
        if ("gte" in where.startAt && (row.startAt as Date) < (where.startAt.gte as Date)) return false;
        if ("lt" in where.startAt && (row.startAt as Date) >= (where.startAt.lt as Date)) return false;
      }
      return true;
    });
  }) as typeof prisma.calendarEvent.findMany;

  prisma.calendarEvent.findFirst = (async (args) => {
    const where = args?.where ?? {};
    return (
      [...store.events.values()].find((row) => {
        if (where.id && row.id !== where.id) return false;
        if (where.organizationId && row.organizationId !== where.organizationId) return false;
        if (where.workCaseId && row.workCaseId !== where.workCaseId) return false;
        return true;
      }) ?? null
    );
  }) as typeof prisma.calendarEvent.findFirst;

  prisma.calendarEvent.update = (async (args) => {
    const row = store.events.get(args.where.id)!;
    Object.assign(row, args.data, { updatedAt: new Date() });
    return row;
  }) as typeof prisma.calendarEvent.update;

  prisma.workCaseTimelineEntry.create = (async (args) => {
    const row = {
      id: store.nextId("tl"),
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId,
      calendarEventId: args.data.calendarEventId ?? null,
      type: args.data.type,
      summary: args.data.summary,
      actorType: args.data.actorType,
      actorUserId: args.data.actorUserId ?? null,
      metaJson: args.data.metaJson ?? null,
      createdAt: new Date(),
    };
    store.timeline.push(row);
    return row;
  }) as typeof prisma.workCaseTimelineEntry.create;

  prisma.workCaseTimelineEntry.findMany = (async (args) => {
    const where = args?.where ?? {};
    let rows = store.timeline.filter((row) => {
      if (where.organizationId && row.organizationId !== where.organizationId) return false;
      if (where.workCaseId && row.workCaseId !== where.workCaseId) return false;
      return true;
    });
    rows = rows.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    const take = args?.take ?? rows.length;
    return rows.slice(0, take);
  }) as typeof prisma.workCaseTimelineEntry.findMany;

  prisma.calendarEventAudit.create = (async (args) => {
    const row = {
      id: store.nextId("audit"),
      calendarEventId: args.data.calendarEventId,
      organizationId: args.data.organizationId,
      action: args.data.action,
      actorType: args.data.actorType,
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
    const id = store.nextId("dec");
    const row = {
      id,
      organizationId: args.data.organizationId,
      workCaseId: args.data.workCaseId,
      calendarEventId: args.data.calendarEventId ?? null,
      type: args.data.type,
      status: args.data.status ?? "pending",
      title: args.data.title,
      reason: args.data.reason ?? null,
      preparedPayloadJson: args.data.preparedPayloadJson ?? null,
      source: args.data.source,
      executionIdempotencyKey: null,
      metaJson: null,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      workCase: store.workCases.get(String(args.data.workCaseId)),
      calendarEvent: args.data.calendarEventId ? store.events.get(String(args.data.calendarEventId)) : null,
    };
    store.decisions.set(id, row);
    return row;
  }) as typeof prisma.ownerDecisionQueueItem.create;

  prisma.ownerDecisionQueueItem.findMany = (async (args) => {
    const where = args?.where ?? {};
    return [...store.decisions.values()].filter((row) => {
      if (where.organizationId && row.organizationId !== where.organizationId) return false;
      if (where.status && row.status !== where.status) return false;
      return true;
    });
  }) as typeof prisma.ownerDecisionQueueItem.findMany;

  prisma.ownerDecisionQueueItem.findFirst = (async (args) => {
    const where = args?.where ?? {};
    return (
      [...store.decisions.values()].find((row) => {
        if (where.id && row.id !== where.id) return false;
        if (where.organizationId && row.organizationId !== where.organizationId) return false;
        return true;
      }) ?? null
    );
  }) as typeof prisma.ownerDecisionQueueItem.findFirst;

  prisma.ownerDecisionQueueItem.update = (async (args) => {
    const row = store.decisions.get(args.where.id)!;
    Object.assign(row, args.data, { updatedAt: new Date() });
    return row;
  }) as typeof prisma.ownerDecisionQueueItem.update;

  prisma.task.create = (async (args) => {
    const row = {
      id: store.nextId("task"),
      ...args.data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.tasks.push(row);
    return row;
  }) as typeof prisma.task.create;

  prisma.task.count = (async () => 0) as typeof prisma.task.count;

  return () => {
    Object.assign(prisma, originals);
  };
}

function createTestApp(auth: JwtPayload) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    next();
  });
  app.use(calendarEngineRouter);
  return app;
}

async function withServer<T>(auth: JwtPayload, fn: (baseUrl: string) => Promise<T>) {
  const app = createTestApp(auth);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function api(baseUrl: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  return { status: res.status, body };
}

function enableFlags() {
  process.env.CALENDAR_ENGINE_V1_READ = "true";
  process.env.CALENDAR_ENGINE_V1_WRITE = "true";
}

function disableFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

test("calendar engine routes return 503 when flags disabled", async () => {
  disableFlags();
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const res = await api(baseUrl, "/work-cases");
      assert.equal(res.status, 503);
      assert.equal(res.body.code, "CALENDAR_ENGINE_DISABLED");
    });
  } finally {
    enableFlags();
  }
});

test("POST /calendar/events rejects organizationId from body", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const res = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          organizationId: ORG_B,
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
        }),
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "FORBIDDEN");
    });
  } finally {
    restore();
  }
});

test("POST /calendar/events rejects source=ai_chat", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const res = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
          source: "ai_chat",
        }),
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "FORBIDDEN");
    });
  } finally {
    restore();
  }
});

test("PATCH /calendar/events/:id rejects direct status change", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const created = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Consult",
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
        }),
      });
      assert.equal(created.status, 201);

      const patched = await api(baseUrl, `/calendar/events/${created.body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed" }),
      });
      assert.equal(patched.status, 403);
      assert.equal(patched.body.code, "FORBIDDEN");
    });
  } finally {
    restore();
  }
});

test("create work case and draft calendar event via API", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const workCaseRes = await api(baseUrl, "/work-cases", {
        method: "POST",
        body: JSON.stringify({ title: "API Work Case" }),
      });
      assert.equal(workCaseRes.status, 201);
      assert.equal(workCaseRes.body.title, "API Work Case");

      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          title: "API Event",
          workCaseId: workCaseRes.body.id,
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      assert.equal(eventRes.status, 201);
      assert.equal(eventRes.body.status, "draft");
    });
  } finally {
    restore();
  }
});

test("submit for confirmation creates decision queue item", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Confirm Me",
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      const submitRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/submit-for-confirmation`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      assert.equal(submitRes.status, 200);
      assert.equal(submitRes.body.mode, "queued");
      assert.equal(submitRes.body.queueType, "confirm_appointment");
    });
  } finally {
    restore();
  }
});

test("approve confirm decision transitions event to confirmed", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      const submitRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/submit-for-confirmation`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const approveRes = await api(baseUrl, `/owner-decisions/${submitRes.body.decisionId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      assert.equal(approveRes.status, 200);

      const getRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.status, "confirmed");
    });
  } finally {
    restore();
  }
});

test("conflict during confirmation creates override decision", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  const originalAppointmentFindMany = prisma.appointment.findMany.bind(prisma.appointment);
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-1",
      startTime: new Date("2026-06-25T10:30:00.000Z"),
      durationMinutes: 60,
      client: { name: "Busy Client" },
      service: { name: "Cut" },
    },
  ]) as typeof prisma.appointment.findMany;

  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      const submitRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/submit-for-confirmation`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      assert.equal(submitRes.body.queueType, "override_conflict");
    });
  } finally {
    prisma.appointment.findMany = originalAppointmentFindMany;
    restore();
  }
});

test("reject decision writes timeline entry", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      const submitRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/submit-for-confirmation`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const rejectRes = await api(baseUrl, `/owner-decisions/${submitRes.body.decisionId}/reject`, {
        method: "POST",
        body: JSON.stringify({ resolutionNote: "לא עכשיו" }),
      });
      assert.equal(rejectRes.status, 200);
      assert.equal(rejectRes.body.status, "rejected");
      assert.ok(store.timeline.some((entry) => entry.type === "approval_rejected"));
    });
  } finally {
    restore();
  }
});

test("work case timeline is returned paginated", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const workCaseRes = await api(baseUrl, "/work-cases", {
        method: "POST",
        body: JSON.stringify({ title: "Timeline Case" }),
      });
      const timelineRes = await api(baseUrl, `/work-cases/${workCaseRes.body.id}/timeline?limit=10`);
      assert.equal(timelineRes.status, 200);
      assert.ok(Array.isArray(timelineRes.body.items));
      assert.ok(timelineRes.body.items.length >= 1);
      assert.equal(typeof timelineRes.body.hasMore, "boolean");
    });
  } finally {
    restore();
  }
});

test("cross-org access returns 404", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    let eventId = "";
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
        }),
      });
      eventId = eventRes.body.id;
    });

    await withServer(AUTH_B, async (baseUrl) => {
      const res = await api(baseUrl, `/calendar/events/${eventId}`);
      assert.equal(res.status, 404);
      assert.equal(res.body.code, "NOT_FOUND");
    });
  } finally {
    restore();
  }
});

test("approve same decision twice is idempotent", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-25T10:00:00.000Z",
          endAt: "2026-06-25T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      const submitRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/submit-for-confirmation`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const first = await api(baseUrl, `/owner-decisions/${submitRes.body.decisionId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const second = await api(baseUrl, `/owner-decisions/${submitRes.body.decisionId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.body.executed, true);
      assert.equal(second.body.executed, false);
    });
  } finally {
    restore();
  }
});

test("calendar engine complete and no-show routes transition confirmed events", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-20T10:00:00.000Z",
          endAt: "2026-06-20T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      const submitRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/submit-for-confirmation`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await api(baseUrl, `/owner-decisions/${submitRes.body.decisionId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const completeRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          completionNotes: "Session done",
          completionOutcome: "completed_success",
        }),
      });
      assert.equal(completeRes.status, 200);
      assert.equal(completeRes.body.status, "completed");
      assert.ok(store.timeline.some((entry) => entry.type === "event_completed"));
      assert.ok(store.tasks.length >= 1);
    });
  } finally {
    restore();
  }
});

test("calendar engine no-show route rejects missing notes", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  try {
    await withServer(AUTH_A, async (baseUrl) => {
      const eventRes = await api(baseUrl, "/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-20T10:00:00.000Z",
          endAt: "2026-06-20T11:00:00.000Z",
          clientId: "client-1",
          prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
        }),
      });
      const submitRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/submit-for-confirmation`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await api(baseUrl, `/owner-decisions/${submitRes.body.decisionId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const noShowRes = await api(baseUrl, `/calendar/events/${eventRes.body.id}/no-show`, {
        method: "POST",
        body: JSON.stringify({ notes: "  " }),
      });
      assert.equal(noShowRes.status, 400);
    });
  } finally {
    restore();
  }
});

test("calendar engine routes do not create FinancialDocumentReview rows", async () => {
  enableFlags();
  const store = createStore();
  const restore = installMocks(store);
  const original = (prisma as { financialDocumentReview?: { create?: unknown } }).financialDocumentReview;
  let createCalled = false;
  (prisma as { financialDocumentReview: { create: typeof prisma.workCase.create } }).financialDocumentReview = {
    create: (async () => {
      createCalled = true;
      throw new Error("should not create financial document review");
    }) as typeof prisma.workCase.create,
  };

  try {
    await withServer(AUTH_A, async (baseUrl) => {
      await api(baseUrl, "/work-cases", {
        method: "POST",
        body: JSON.stringify({ title: "No Finance" }),
      });
    });
    assert.equal(createCalled, false);
  } finally {
    if (original) {
      (prisma as { financialDocumentReview?: unknown }).financialDocumentReview = original;
    } else {
      delete (prisma as { financialDocumentReview?: unknown }).financialDocumentReview;
    }
    restore();
  }
});
