import "./stressEnvBootstrap.js";
import nodeTest from "node:test";
import assert from "node:assert/strict";

import { createAppointmentForOrganization, updateAppointmentForOrganization } from "../services/appointmentService.js";
import {
  cleanupStressOrg,
  confirmCalendarEventBlocking,
  createStressOrg,
  ensureStressEnv,
  isSafeStressDatabaseUrl,
  isStressDbEnabled,
  postAppointmentHttp,
  postNatalieAppointmentHttp,
  seedDraftCalendarEvent,
  startStressApiServer,
  stressSlotRange,
  summarizeMetrics,
  validateDbConsistency,
  voiceBookAppointment,
  writeStressReport,
  type RequestOutcome,
  type StressMetrics,
} from "./schedulingStressHarness.js";

const test: typeof nodeTest = ((name: string, fn: Parameters<typeof nodeTest>[1]) =>
  nodeTest(name, { skip: isStressDbEnabled() && isSafeStressDatabaseUrl() ? false : "set STRESS_DB=1 with local DATABASE_URL" }, fn)) as typeof nodeTest;

const reports: StressMetrics[] = [];

function appointmentBody(fixture: { clientId: string }, iso: string) {
  return {
    clientId: fixture.clientId,
    startTime: iso,
    durationMinutes: 60,
    status: "confirmed",
  };
}

function natalieBody(fixture: { clientName: string }, iso: string) {
  return {
    clientName: fixture.clientName,
    startTime: iso,
    durationMinutes: 60,
  };
}

test("Scenario A — 100 concurrent POST /appointments on same slot", async (t) => {
  await ensureStressEnv();
  const fixture = await createStressOrg({ prefix: "scenario-a" });
  const { baseUrl, close } = await startStressApiServer();
  const { start, end, iso } = stressSlotRange();

  t.after(async () => {
    await close();
    await cleanupStressOrg(fixture.organizationId);
  });

  const wallStart = performance.now();
  const outcomes = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      postAppointmentHttp(baseUrl, fixture.token, appointmentBody(fixture, iso), `appt-${i}`)
    )
  );
  const wallClockMs = performance.now() - wallStart;

  const successes = outcomes.filter((o) => o.ok);
  const conflicts = outcomes.filter((o) => o.conflict);
  const nonSuccess = outcomes.length - successes.length;
  assert.equal(successes.length, 1, `expected exactly 1 success, got ${successes.length}`);
  assert.equal(nonSuccess, 99, `expected 99 non-success outcomes, got ${nonSuccess} (conflicts=${conflicts.length})`);

  const dbValidation = await validateDbConsistency(fixture.organizationId, start, end);
  assert.equal(dbValidation.ok, true, dbValidation.notes.join("; "));

  const metrics = summarizeMetrics("A", outcomes, wallClockMs, dbValidation);
  reports.push(metrics);
  writeStressReport("scenario-a", metrics);
});

test("Scenario B — 50 appointments + 50 engine confirmations on same slot", async (t) => {
  await ensureStressEnv();
  const fixture = await createStressOrg({ prefix: "scenario-b", engineEnabled: true });
  const { baseUrl, close } = await startStressApiServer();
  const { start, end, iso } = stressSlotRange();

  const draftIds = await Promise.all(
    Array.from({ length: 50 }, (_, i) => seedDraftCalendarEvent(fixture, start, `b-${i}`))
  );

  t.after(async () => {
    await close();
    await cleanupStressOrg(fixture.organizationId);
  });

  const wallStart = performance.now();
  const outcomes = await Promise.all([
    ...Array.from({ length: 50 }, (_, i) =>
      postAppointmentHttp(baseUrl, fixture.token, appointmentBody(fixture, iso), `appt-b-${i}`)
    ),
    ...draftIds.map((eventId, i) =>
      confirmCalendarEventBlocking(fixture, eventId, `engine-b-${i}`)
    ),
  ]);
  const wallClockMs = performance.now() - wallStart;

  const dbValidation = await validateDbConsistency(fixture.organizationId, start, end);
  assert.equal(dbValidation.overlappingBlockingPairs, 0, "must not have two confirmed blocking bookings");
  assert.ok(dbValidation.blockingAppointments + dbValidation.blockingCalendarEvents <= 1, "at most one blocking entity");

  const metrics = summarizeMetrics("B", outcomes, wallClockMs, dbValidation);
  reports.push(metrics);
  writeStressReport("scenario-b", metrics);
});

test("Scenario C — mixed channels on same slot", async (t) => {
  await ensureStressEnv();
  const fixture = await createStressOrg({ prefix: "scenario-c", engineEnabled: true });
  const { baseUrl, close } = await startStressApiServer();
  const { start, end, iso } = stressSlotRange();
  const draftId = await seedDraftCalendarEvent(fixture, start, "c-engine");

  t.after(async () => {
    await close();
    await cleanupStressOrg(fixture.organizationId);
  });

  const wallStart = performance.now();
  const outcomes = await Promise.all([
    postAppointmentHttp(baseUrl, fixture.token, appointmentBody(fixture, iso), "dashboard"),
    postNatalieAppointmentHttp(baseUrl, fixture.token, natalieBody(fixture, iso), "natalie"),
    voiceBookAppointment(fixture, iso, "voice"),
    confirmCalendarEventBlocking(fixture, draftId, "engine-confirm"),
  ]);
  const wallClockMs = performance.now() - wallStart;

  const dbValidation = await validateDbConsistency(fixture.organizationId, start, end);
  assert.equal(dbValidation.overlappingBlockingPairs, 0);
  assert.ok(dbValidation.blockingAppointments + dbValidation.blockingCalendarEvents <= 1);

  const metrics = summarizeMetrics("C", outcomes, wallClockMs, dbValidation);
  reports.push(metrics);
  writeStressReport("scenario-c", metrics);
});

test("Scenario D — different organizations do not block each other", async (t) => {
  await ensureStressEnv();
  const orgA = await createStressOrg({ prefix: "scenario-d-a" });
  const orgB = await createStressOrg({ prefix: "scenario-d-b" });
  const { baseUrl, close } = await startStressApiServer();
  const { start, end, iso } = stressSlotRange();

  t.after(async () => {
    await close();
    await cleanupStressOrg(orgA.organizationId);
    await cleanupStressOrg(orgB.organizationId);
  });

  const wallStart = performance.now();
  const outcomes = await Promise.all([
    postAppointmentHttp(baseUrl, orgA.token, appointmentBody(orgA, iso), "org-a"),
    postAppointmentHttp(baseUrl, orgB.token, appointmentBody(orgB, iso), "org-b"),
  ]);
  const wallClockMs = performance.now() - wallStart;

  assert.equal(outcomes.filter((o) => o.ok).length, 2);

  const dbA = await validateDbConsistency(orgA.organizationId, start, end);
  const dbB = await validateDbConsistency(orgB.organizationId, start, end);
  assert.equal(dbA.blockingAppointments, 1);
  assert.equal(dbB.blockingAppointments, 1);

  const metrics = summarizeMetrics("D", outcomes, wallClockMs, {
    ok: dbA.ok && dbB.ok,
    overlappingBlockingPairs: 0,
    blockingAppointments: 2,
    blockingCalendarEvents: 0,
    orphanWorkCases: dbA.orphanWorkCases + dbB.orphanWorkCases,
    orphanCalendarEvents: dbA.orphanCalendarEvents + dbB.orphanCalendarEvents,
    brokenForeignKeys: [],
    notes: ["cross-org isolation verified"],
  });
  reports.push(metrics);
  writeStressReport("scenario-d", metrics);
});

test("Scenario E — cancelled appointment replacement succeeds", async (t) => {
  await ensureStressEnv();
  const fixture = await createStressOrg({ prefix: "scenario-e" });
  const { start, end, iso } = stressSlotRange();

  t.after(async () => {
    await cleanupStressOrg(fixture.organizationId);
  });

  const original = await createAppointmentForOrganization({
    organizationId: fixture.organizationId,
    clientId: fixture.clientId,
    startTime: start,
    durationMinutes: 60,
    status: "confirmed",
    source: "manual",
  });

  await updateAppointmentForOrganization({
    organizationId: fixture.organizationId,
    appointmentId: original.id,
    status: "cancelled",
  });

  const wallStart = performance.now();
  const replacement = await createAppointmentForOrganization({
    organizationId: fixture.organizationId,
    clientId: fixture.clientId,
    startTime: start,
    durationMinutes: 60,
    status: "confirmed",
    source: "manual",
  });
  const wallClockMs = performance.now() - wallStart;

  const outcomes: RequestOutcome[] = [
    {
      label: "replacement",
      ok: Boolean(replacement.id),
      status: 201,
      durationMs: wallClockMs,
      conflict: false,
    },
  ];

  const dbValidation = await validateDbConsistency(fixture.organizationId, start, end);
  assert.equal(dbValidation.blockingAppointments, 1);

  const metrics = summarizeMetrics("E", outcomes, wallClockMs, dbValidation);
  reports.push(metrics);
  writeStressReport("scenario-e", metrics);
});

test("Scenario F — override_conflict allows explicit overlap", async (t) => {
  await ensureStressEnv();
  const fixture = await createStressOrg({ prefix: "scenario-f", engineEnabled: true });
  const { start, end } = stressSlotRange();

  t.after(async () => {
    await cleanupStressOrg(fixture.organizationId);
  });

  await createAppointmentForOrganization({
    organizationId: fixture.organizationId,
    clientId: fixture.clientId,
    startTime: start,
    durationMinutes: 60,
    status: "confirmed",
    source: "manual",
  });

  const eventId = await seedDraftCalendarEvent(fixture, start, "override");
  const wallStart = performance.now();

  const submit = await import("../services/calendar/calendarEventService.js").then((m) =>
    m.submitCalendarEventForConfirmation(fixture.organizationId, eventId, {
      actorType: "user",
      actorUserId: fixture.userId,
    })
  );
  assert.equal(submit.mode, "queued");
  assert.equal(submit.queueType, "override_conflict");

  const { approveDecisionQueueItem } = await import("../services/calendar/decisionQueueService.js");
  await approveDecisionQueueItem(fixture.organizationId, submit.decisionId, {
    actorType: "user",
    actorUserId: fixture.userId,
  });

  const wallClockMs = performance.now() - wallStart;
  const dbValidation = await validateDbConsistency(fixture.organizationId, start, end, {
    maxBlockingEntities: 2,
    allowOverlapCount: 1,
  });

  assert.equal(dbValidation.blockingAppointments, 1);
  assert.equal(dbValidation.blockingCalendarEvents, 1);
  assert.equal(dbValidation.overlappingBlockingPairs, 1);

  const outcomes: RequestOutcome[] = [
    {
      label: "override_conflict",
      ok: true,
      status: 200,
      durationMs: wallClockMs,
      conflict: false,
    },
  ];
  const metrics = summarizeMetrics("F", outcomes, wallClockMs, dbValidation);
  reports.push(metrics);
  writeStressReport("scenario-f", metrics);
});

nodeTest.after(() => {
  if (reports.length === 0) return;
  const aggregate = {
    scenarios: reports.length,
    totalRequests: reports.reduce((sum, r) => sum + r.requestsExecuted, 0),
    totalSuccesses: reports.reduce((sum, r) => sum + r.successfulBookings, 0),
    totalConflicts: reports.reduce((sum, r) => sum + r.rejectedConflicts, 0),
    avgP95Ms: Math.round(reports.reduce((sum, r) => sum + r.p95LatencyMs, 0) / reports.length),
    allDbValid: reports.every((r) => r.dbValidation.ok),
  };
  console.log("\n=== SCHEDULING STRESS REPORT ===");
  console.log(JSON.stringify({ aggregate, reports }, null, 2));
});
