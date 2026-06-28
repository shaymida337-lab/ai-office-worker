/**
 * Phase 11.5 — Pilot runtime verification (local/staging only).
 *
 * Prerequisites:
 *   - Phase 1 + Phase 11 migrations applied
 *   - CALENDAR_ENGINE_PILOT_ADMIN=true for org enable step (run pilot script first)
 *
 * Usage:
 *   cd backend
 *   CALENDAR_ENGINE_V1_READ=true CALENDAR_ENGINE_V1_WRITE=true CALENDAR_ENGINE_PILOT_ADMIN=true npx tsx scripts/calendar-engine-pilot-org.ts enable --org-id <id>
 *   CALENDAR_ENGINE_V1_READ=true CALENDAR_ENGINE_V1_WRITE=true npx tsx scripts/calendar-engine-pilot-runtime-smoke.ts
 */
import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma.js";
import { signToken } from "../src/lib/auth.js";
import { apiRouter } from "../src/routes/api.js";
import { getSchedulingCapabilities } from "../src/services/scheduling/schedulingCapabilities.js";
import { getBriefingSchedulingSnapshot } from "../src/services/scheduling/briefingSchedulingReader.js";
import { bookAppointmentViaNatalie } from "../src/services/scheduling/schedulingFacade.js";
import { checkSlotAvailability } from "../src/services/calendar/availability.js";
import { createAppointmentForOrganization } from "../src/services/appointmentService.js";

process.env.CALENDAR_ENGINE_V1_READ = "true";
process.env.CALENDAR_ENGINE_V1_WRITE = "true";

type SmokeContext = {
  pilotOrgId: string;
  pilotUserId: string;
  pilotEmail: string;
  pilotToken: string;
  nonPilotOrgId: string;
  nonPilotToken: string;
  clientId: string;
  clientName: string;
};

async function setOrgEngineFlags(
  organizationId: string,
  flags: { read: boolean; write: boolean; googleMirror: boolean; notes?: string | null }
) {
  const notesClause =
    flags.notes !== undefined
      ? `calendar_engine_pilot_notes = ${flags.notes === null ? "NULL" : `'${String(flags.notes).replace(/'/g, "''")}'`},`
      : "";
  await prisma.$executeRawUnsafe(
    `UPDATE "Organization"
     SET calendar_engine_read_enabled = ${flags.read},
         calendar_engine_write_enabled = ${flags.write},
         calendar_engine_google_mirror_enabled = ${flags.googleMirror},
         ${notesClause}
         "updatedAt" = NOW()
     WHERE id = '${organizationId}'`
  );
}

async function ensureFixtures(): Promise<SmokeContext> {
  const users = await prisma.$queryRaw<
    { id: string; email: string; organizationId: string; orgName: string }[]
  >`
    SELECT u.id, u.email, o.id AS "organizationId", o.name AS "orgName"
    FROM "User" u
    JOIN "Organization" o ON o."userId" = u.id
    ORDER BY o."createdAt" ASC
    LIMIT 2
  `;

  let pilot = users[0];
  if (!pilot) {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const email = `pilot-smoke-${userId}@example.com`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ('${userId}', '${email}', 'Pilot Smoke', NOW(), NOW())`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Organization" (id, "userId", name, "createdAt", "updatedAt") VALUES ('${organizationId}', '${userId}', 'Pilot Org', NOW(), NOW())`
    );
    pilot = { id: userId, email, organizationId, orgName: "Pilot Org" };
  }

  let nonPilotOrgId = users[1]?.organizationId;
  if (!nonPilotOrgId || nonPilotOrgId === pilot.organizationId) {
    const userId = randomUUID();
    nonPilotOrgId = randomUUID();
    const email = `non-pilot-smoke-${userId}@example.com`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ('${userId}', '${email}', 'Non Pilot', NOW(), NOW())`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Organization" (id, "userId", name, "createdAt", "updatedAt",
        calendar_engine_read_enabled, calendar_engine_write_enabled, calendar_engine_google_mirror_enabled)
       VALUES ('${nonPilotOrgId}', '${userId}', 'Non Pilot Org', NOW(), NOW(), false, false, false)`
    );
  } else {
    await setOrgEngineFlags(nonPilotOrgId, { read: false, write: false, googleMirror: false });
  }

  await setOrgEngineFlags(pilot.organizationId, {
    read: true,
    write: true,
    googleMirror: false,
    notes: "Phase 11.5 pilot runtime smoke",
  });

  const clients = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM "Client"
    WHERE "organizationId" = ${pilot.organizationId} AND "isActive" = true
    LIMIT 1
  `;

  let clientId = clients[0]?.id;
  let clientName = clients[0]?.name ?? "Smoke Client";
  if (!clientId) {
    clientId = randomUUID();
    clientName = "Smoke Client";
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Client" (id, "organizationId", name, email, "isActive", "createdAt", "updatedAt")
       VALUES ('${clientId}', '${pilot.organizationId}', '${clientName}', 'smoke-${clientId}@example.com', true, NOW(), NOW())`
    );
  }

  const pilotToken = signToken({
    userId: pilot.id,
    organizationId: pilot.organizationId,
    email: pilot.email,
  });
  const nonPilotUser = users[1] ?? { id: pilot.id, email: pilot.email };
  const nonPilotToken = signToken({
    userId: nonPilotUser.id,
    organizationId: nonPilotOrgId,
    email: nonPilotUser.email,
  });

  return {
    pilotOrgId: pilot.organizationId,
    pilotUserId: pilot.id,
    pilotEmail: pilot.email,
    pilotToken,
    nonPilotOrgId,
    nonPilotToken,
    clientId,
    clientName,
  };
}

async function withApiServer(authToken: string, fn: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const payload = JSON.parse(Buffer.from(authToken.split(".")[1]!, "base64url").toString("utf8"));
    req.auth = payload;
    next();
  });
  app.use("/api", apiRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function api(baseUrl: string, token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  return { status: res.status, body };
}

function assertStep(label: string, ok: boolean, detail?: unknown) {
  if (!ok) {
    throw new Error(`${label} FAILED${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  }
  console.log(`✔ ${label}`);
}

async function main() {
  const ctx = await ensureFixtures();
  console.log("Pilot org:", ctx.pilotOrgId);
  console.log("Non-pilot org:", ctx.nonPilotOrgId);
  console.log("Client:", ctx.clientId, ctx.clientName);

  const pilotCaps = await getSchedulingCapabilities(ctx.pilotOrgId);
  assertStep("capabilities enabled for pilot org", pilotCaps.source === "enabled" && pilotCaps.calendarEngineReadEnabled);
  console.log("  ", pilotCaps);

  const nonPilotCaps = await getSchedulingCapabilities(ctx.nonPilotOrgId);
  assertStep("capabilities disabled for non-pilot org", nonPilotCaps.source === "org_disabled");
  console.log("  ", nonPilotCaps);

  const slotStart = new Date();
  slotStart.setUTCDate(slotStart.getUTCDate() + 14);
  slotStart.setUTCHours(10, 0, 0, 0);
  const slotIso = slotStart.toISOString();

  const legacyAppt = await createAppointmentForOrganization({
    organizationId: ctx.pilotOrgId,
    clientId: ctx.clientId,
    startTime: slotStart,
    durationMinutes: 30,
    source: "manual",
    status: "confirmed",
  });
  assertStep("seed legacy appointment for unified availability", Boolean(legacyAppt.id));

  const conflict = await checkSlotAvailability({
    organizationId: ctx.pilotOrgId,
    startTime: slotStart,
    durationMinutes: 30,
  });
  assertStep("unified availability blocks overlapping slot", conflict.available === false);
  console.log("  conflict reason:", conflict.reason);

  const freeStart = new Date(slotStart.getTime() + 60 * 60_000);
  const freeCheck = await checkSlotAvailability({
    organizationId: ctx.pilotOrgId,
    startTime: freeStart,
    durationMinutes: 30,
  });
  assertStep("unified availability allows free slot", freeCheck.available === true);

  const book = await bookAppointmentViaNatalie({
    organizationId: ctx.pilotOrgId,
    userId: ctx.pilotUserId,
    clientName: ctx.clientName,
    startTime: freeStart.toISOString(),
    durationMinutes: 30,
  });
  assertStep("Natalie book uses engine path", book.engine === true && book.pendingApproval === true);
  console.log("  decisionId:", book.engine ? book.decisionId : null);

  const briefing = await getBriefingSchedulingSnapshot(ctx.pilotOrgId);
  assertStep(
    "briefing sees engine read + pending decisions",
    briefing.engineReadEnabled === true && briefing.pendingDecisions.length >= 1
  );
  const decisionHref = briefing.pendingDecisions[0]?.href ?? "";
  assertStep("briefing decision deep link present", decisionHref.includes("decisionId="));
  const decisionId = briefing.pendingDecisions[0]?.id;
  assertStep("decision id resolved", Boolean(decisionId));

  await withApiServer(ctx.pilotToken, async (baseUrl) => {
    const capsHttp = await api(baseUrl, ctx.pilotToken, "/api/scheduling/capabilities");
    assertStep("GET /api/scheduling/capabilities HTTP 200", capsHttp.status === 200 && capsHttp.body?.source === "enabled");

    const approve = await api(baseUrl, ctx.pilotToken, `/api/owner-decisions/${decisionId}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assertStep("approve owner decision", approve.status === 200 && approve.body?.executed === true);

    if (book.engine && book.calendarEventId) {
      const event = await api(baseUrl, ctx.pilotToken, `/api/calendar/events/${book.calendarEventId}`);
      assertStep("event confirmed after approve", event.status === 200 && event.body?.status === "confirmed");

      const timeline = await api(baseUrl, ctx.pilotToken, `/api/work-cases/${book.workCaseId}/timeline?limit=20`);
      assertStep("timeline has entries after approve", timeline.status === 200 && (timeline.body?.items?.length ?? 0) > 0);
    }
  });

  await setOrgEngineFlags(ctx.pilotOrgId, { read: false, write: false, googleMirror: false });
  const disabledCaps = await getSchedulingCapabilities(ctx.pilotOrgId);
  assertStep("org flag disable → capabilities org_disabled", disabledCaps.source === "org_disabled");

  const legacyBook = await bookAppointmentViaNatalie({
    organizationId: ctx.pilotOrgId,
    userId: ctx.pilotUserId,
    clientName: ctx.clientName,
    startTime: new Date(freeStart.getTime() + 2 * 60 * 60_000).toISOString(),
    durationMinutes: 30,
  });
  assertStep("org disabled → Natalie uses legacy appointment path", legacyBook.engine === false);

  await setOrgEngineFlags(ctx.pilotOrgId, { read: true, write: true, googleMirror: false });

  const fdrDelta = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "FinancialDocumentReview" WHERE "organizationId" = ${ctx.pilotOrgId}
  `;
  console.log("FinancialDocumentReview rows for pilot org:", Number(fdrDelta[0]?.count ?? 0));
  console.log("Google mirror: skipped (no connected test account / org mirror flag OFF)");
  console.log("");
  console.log("PHASE 11.5 PILOT RUNTIME SMOKE PASSED");
}

main()
  .catch((err) => {
    console.error("PHASE 11.5 PILOT RUNTIME SMOKE FAILED", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
