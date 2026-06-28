import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma.js";
import type { CalendarGoogleMirrorDeps } from "./calendarGoogleMirrorService.js";
import {
  mirrorCalendarEventToGoogleAfterConfirm,
  removeCalendarEngineGoogleMirror,
  runDecisionGoogleMirrorSideEffects,
} from "./calendarGoogleMirrorService.js";

const ORG_ID = "org-mirror-test";
const EVENT_ID = "event-mirror-1";
const WORK_CASE_ID = "wc-mirror-1";
const ACTOR = { actorType: "user" as const, actorUserId: "user-1" };

type Store = {
  events: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  organizations: Array<Record<string, unknown>>;
};

function createStore(overrides?: Partial<Record<string, unknown>>): Store {
  return {
    organizations: [
      {
        id: ORG_ID,
        calendarEngineReadEnabled: true,
        calendarEngineWriteEnabled: true,
        calendarEngineGoogleMirrorEnabled: true,
        calendarAutonomyJson: {
          calendarAutonomy: { autoSyncGoogleOnConfirm: true },
        },
      },
    ],
    events: [
      {
        id: EVENT_ID,
        organizationId: ORG_ID,
        workCaseId: WORK_CASE_ID,
        status: "confirmed",
        title: "Consultation",
        startAt: new Date("2026-06-25T10:00:00.000Z"),
        endAt: new Date("2026-06-25T11:00:00.000Z"),
        timezone: "Asia/Jerusalem",
        locationType: "office",
        address: "רחוב הרצל 1",
        internalNotes: "secret payment info",
        completionNotes: null,
        prerequisitesJson: [],
        googleEventId: null,
        googleSyncStatus: "skipped",
        client: { name: "דנה" },
        service: { name: "ייעוץ" },
        ...overrides,
      },
    ],
    audits: [],
    timeline: [],
  };
}

function installPrismaMocks(store: Store) {
  const original = {
    findFirstOrg: prisma.organization.findFirst.bind(prisma.organization),
    findUniqueOrg: prisma.organization.findUnique.bind(prisma.organization),
    findFirstEvent: prisma.calendarEvent.findFirst.bind(prisma.calendarEvent),
    updateEvent: prisma.calendarEvent.update.bind(prisma.calendarEvent),
    transaction: prisma.$transaction.bind(prisma),
    auditCreate: prisma.calendarEventAudit.create.bind(prisma.calendarEventAudit),
    timelineCreate: prisma.workCaseTimelineEntry.create.bind(prisma.workCaseTimelineEntry),
  };

  prisma.organization.findFirst = (async () =>
    store.organizations[0] ?? null) as typeof prisma.organization.findFirst;

  prisma.organization.findUnique = (async () => {
    const org = store.organizations[0];
    if (!org) return null;
    return {
      calendarEngineReadEnabled: org.calendarEngineReadEnabled ?? false,
      calendarEngineWriteEnabled: org.calendarEngineWriteEnabled ?? false,
      calendarEngineGoogleMirrorEnabled: org.calendarEngineGoogleMirrorEnabled ?? false,
    };
  }) as typeof prisma.organization.findUnique;

  prisma.calendarEvent.findFirst = (async (args) => {
    const where = (args as { where?: { id?: string; organizationId?: string } }).where;
    const match = store.events.find(
      (event) =>
        (!where?.id || event.id === where.id) &&
        (!where?.organizationId || event.organizationId === where.organizationId)
    );
    return (match as never) ?? null;
  }) as typeof prisma.calendarEvent.findFirst;

  prisma.calendarEvent.update = (async (args) => {
    const where = (args as { where: { id: string }; data: Record<string, unknown> }).where;
    const data = (args as { data: Record<string, unknown> }).data;
    const event = store.events.find((item) => item.id === where.id);
    if (!event) throw new Error("event not found");
    Object.assign(event, data);
    return event as never;
  }) as typeof prisma.calendarEvent.update;

  prisma.calendarEventAudit.create = (async (args) => {
    const row = { ...(args as { data: Record<string, unknown> }).data, id: `audit-${store.audits.length + 1}` };
    store.audits.push(row);
    return row as never;
  }) as typeof prisma.calendarEventAudit.create;

  prisma.workCaseTimelineEntry.create = (async (args) => {
    const row = {
      ...(args as { data: Record<string, unknown> }).data,
      id: `timeline-${store.timeline.length + 1}`,
    };
    store.timeline.push(row);
    return row as never;
  }) as typeof prisma.workCaseTimelineEntry.create;

  prisma.$transaction = (async (fn) => fn(prisma)) as typeof prisma.$transaction;

  return () => {
    prisma.organization.findFirst = original.findFirstOrg;
    prisma.organization.findUnique = original.findUniqueOrg;
    prisma.calendarEvent.findFirst = original.findFirstEvent;
    prisma.calendarEvent.update = original.updateEvent;
    prisma.$transaction = original.transaction;
    prisma.calendarEventAudit.create = original.auditCreate;
    prisma.workCaseTimelineEntry.create = original.timelineCreate;
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

function createDeps(overrides: Partial<CalendarGoogleMirrorDeps> = {}): CalendarGoogleMirrorDeps {
  return {
    getCalendarClientForOrganization: async () => ({ connected: true }) as never,
    insertCalendarEngineGoogleEvent: async () => "google-event-123",
    updateCalendarEngineGoogleEvent: async () => true,
    deleteCalendarEngineGoogleEvent: async () => true,
    ...overrides,
  };
}

test("org google mirror flag OFF skips Google sync even when global write ON", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  store.organizations[0] = {
    ...store.organizations[0]!,
    calendarEngineGoogleMirrorEnabled: false,
  };
  const restore = installPrismaMocks(store);
  let insertCalls = 0;
  const deps = createDeps({
    insertCalendarEngineGoogleEvent: async () => {
      insertCalls += 1;
      return "google-event-123";
    },
  });

  try {
    await mirrorCalendarEventToGoogleAfterConfirm(
      { organizationId: ORG_ID, calendarEventId: EVENT_ID, actor: ACTOR },
      deps
    );
    assert.equal(insertCalls, 0);
    assert.equal(store.events[0]?.googleSyncStatus, "skipped");
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});

test("confirm approval triggers Google create when connected", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);
  let insertCalls = 0;
  const deps = createDeps({
    insertCalendarEngineGoogleEvent: async () => {
      insertCalls += 1;
      return "google-event-123";
    },
  });

  try {
    await mirrorCalendarEventToGoogleAfterConfirm(
      { organizationId: ORG_ID, calendarEventId: EVENT_ID, actor: ACTOR },
      deps
    );

    assert.equal(insertCalls, 1);
    assert.equal(store.events[0]?.googleEventId, "google-event-123");
    assert.equal(store.events[0]?.googleSyncStatus, "synced");
    assert.ok(store.timeline.some((entry) => entry.type === "google_sync_success"));
    assert.ok(store.audits.some((entry) => entry.action === "google_sync"));
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});

test("confirm approval does not trigger Google when not connected", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);
  let insertCalls = 0;
  const deps = createDeps({
    getCalendarClientForOrganization: async () => null,
    insertCalendarEngineGoogleEvent: async () => {
      insertCalls += 1;
      return "google-event-123";
    },
  });

  try {
    await mirrorCalendarEventToGoogleAfterConfirm(
      { organizationId: ORG_ID, calendarEventId: EVENT_ID, actor: ACTOR },
      deps
    );

    assert.equal(insertCalls, 0);
    assert.equal(store.events[0]?.googleSyncStatus, "skipped");
    assert.equal(store.timeline.some((entry) => entry.type === "google_sync_success"), false);
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});

test("Google failure keeps event confirmed and writes failed status/timeline", async () => {
  enableCalendarEngineFlags();
  const store = createStore();
  const restore = installPrismaMocks(store);
  const deps = createDeps({
    insertCalendarEngineGoogleEvent: async () => null,
  });

  try {
    await mirrorCalendarEventToGoogleAfterConfirm(
      { organizationId: ORG_ID, calendarEventId: EVENT_ID, actor: ACTOR },
      deps
    );

    assert.equal(store.events[0]?.status, "confirmed");
    assert.equal(store.events[0]?.googleSyncStatus, "failed");
    assert.ok(store.timeline.some((entry) => entry.type === "google_sync_failed"));
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});

test("existing googleEventId causes update not create", async () => {
  enableCalendarEngineFlags();
  const store = createStore({ googleEventId: "existing-google-id" });
  const restore = installPrismaMocks(store);
  let insertCalls = 0;
  let updateCalls = 0;
  const deps = createDeps({
    insertCalendarEngineGoogleEvent: async () => {
      insertCalls += 1;
      return "new-id";
    },
    updateCalendarEngineGoogleEvent: async () => {
      updateCalls += 1;
      return true;
    },
  });

  try {
    await mirrorCalendarEventToGoogleAfterConfirm(
      { organizationId: ORG_ID, calendarEventId: EVENT_ID, actor: ACTOR },
      deps
    );

    assert.equal(insertCalls, 0);
    assert.equal(updateCalls, 1);
    assert.equal(store.events[0]?.googleEventId, "existing-google-id");
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});

test("cancel mirror deletes Google event and marks deleted", async () => {
  enableCalendarEngineFlags();
  const store = createStore({ googleEventId: "existing-google-id", googleSyncStatus: "synced" });
  const restore = installPrismaMocks(store);
  let deleteCalls = 0;
  const deps = createDeps({
    deleteCalendarEngineGoogleEvent: async () => {
      deleteCalls += 1;
      return true;
    },
  });

  try {
    await removeCalendarEngineGoogleMirror(
      { organizationId: ORG_ID, calendarEventId: EVENT_ID, actor: ACTOR },
      deps
    );

    assert.equal(deleteCalls, 1);
    assert.equal(store.events[0]?.googleEventId, null);
    assert.equal(store.events[0]?.googleSyncStatus, "deleted");
    assert.ok(store.timeline.some((entry) => entry.type === "google_sync_success"));
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});

test("no Google calls on draft/pending/rejected statuses", async () => {
  enableCalendarEngineFlags();
  const restoreFns: Array<() => void> = [];
  let insertCalls = 0;
  const deps = createDeps({
    insertCalendarEngineGoogleEvent: async () => {
      insertCalls += 1;
      return "google-event-123";
    },
  });

  for (const status of ["draft", "pending_readiness", "cancelled"] as const) {
    const store = createStore({ status });
    restoreFns.push(installPrismaMocks(store));
    await mirrorCalendarEventToGoogleAfterConfirm(
      { organizationId: ORG_ID, calendarEventId: EVENT_ID, actor: ACTOR },
      deps
    );
  }

  try {
    assert.equal(insertCalls, 0);
  } finally {
    for (const restore of restoreFns.reverse()) restore();
    disableCalendarEngineFlags();
  }
});

test("re-approve side effect with executed=false does not duplicate Google event", async () => {
  enableCalendarEngineFlags();
  const store = createStore({ googleEventId: "existing-google-id" });
  const restore = installPrismaMocks(store);
  let insertCalls = 0;
  const deps = createDeps({
    insertCalendarEngineGoogleEvent: async () => {
      insertCalls += 1;
      return "duplicate";
    },
  });

  try {
    await runDecisionGoogleMirrorSideEffects(
      {
        organizationId: ORG_ID,
        decisionType: "confirm_appointment",
        executed: false,
        result: { calendarEventId: EVENT_ID },
        actor: ACTOR,
      },
      deps
    );

    assert.equal(insertCalls, 0);
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});

test("decision side effect routes reschedule to delete old mirror", async () => {
  enableCalendarEngineFlags();
  const store = createStore({ googleEventId: "existing-google-id" });
  const restore = installPrismaMocks(store);
  let deleteCalls = 0;
  const deps = createDeps({
    deleteCalendarEngineGoogleEvent: async () => {
      deleteCalls += 1;
      return true;
    },
  });

  try {
    await runDecisionGoogleMirrorSideEffects(
      {
        organizationId: ORG_ID,
        decisionType: "reschedule_appointment",
        executed: true,
        result: { oldCalendarEventId: EVENT_ID, newCalendarEventId: "event-new" },
        actor: ACTOR,
      },
      deps
    );

    assert.equal(deleteCalls, 1);
  } finally {
    restore();
    disableCalendarEngineFlags();
  }
});
