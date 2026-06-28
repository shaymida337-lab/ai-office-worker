import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma.js";
import { signToken } from "../src/lib/auth.js";
import { calendarEngineRouter } from "../src/routes/calendarEngineRoutes.js";

process.env.CALENDAR_ENGINE_V1_READ = "true";
process.env.CALENDAR_ENGINE_V1_WRITE = "true";

async function ensureSmokeFixtures() {
  const users = await prisma.$queryRaw<{ id: string; email: string; organizationId: string }[]>`
    SELECT u.id, u.email, o.id AS "organizationId"
    FROM "User" u
    JOIN "Organization" o ON o."userId" = u.id
    LIMIT 1
  `;

  let userId: string;
  let email: string;
  let organizationId: string;

  if (users[0]) {
    userId = users[0].id;
    email = users[0].email;
    organizationId = users[0].organizationId;
  } else {
    userId = randomUUID();
    organizationId = randomUUID();
    email = `calendar-smoke-${userId}@example.com`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ('${userId}', '${email}', 'Calendar Smoke', NOW(), NOW())`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Organization" (id, "userId", name, "createdAt", "updatedAt") VALUES ('${organizationId}', '${userId}', 'Calendar Smoke Org', NOW(), NOW())`
    );
  }

  const clients = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Client" WHERE "organizationId" = ${organizationId} AND "isActive" = true LIMIT 1
  `;

  let clientId = clients[0]?.id;
  if (!clientId) {
    clientId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Client" (id, "organizationId", name, email, "isActive", "createdAt", "updatedAt")
       VALUES ('${clientId}', '${organizationId}', 'Smoke Client', 'smoke-${clientId}@example.com', true, NOW(), NOW())`
    );
  }

  return { userId, email, organizationId, clientId };
}

async function enableOrgEngineFlags(organizationId: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Organization"
     SET calendar_engine_read_enabled = true,
         calendar_engine_write_enabled = true,
         calendar_engine_google_mirror_enabled = false,
         "updatedAt" = NOW()
     WHERE id = '${organizationId}'`
  );
}

async function withServer(token: string, fn: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
    req.auth = payload;
    next();
  });
  app.use(calendarEngineRouter);

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

async function main() {
  const { userId, email, organizationId, clientId } = await ensureSmokeFixtures();
  await enableOrgEngineFlags(organizationId);
  const token = signToken({
    userId,
    organizationId,
    email,
  });

  const fdrBefore = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "FinancialDocumentReview" WHERE "organizationId" = ${organizationId}
  `;

  await withServer(token, async (baseUrl) => {
    const workCase = await api(baseUrl, token, "/work-cases", {
      method: "POST",
      body: JSON.stringify({ title: "Smoke Work Case" }),
    });
    console.log("create WorkCase:", workCase.status, workCase.body?.id ?? workCase.body);
    if (workCase.status !== 201) throw new Error("WorkCase create failed");

    const event = await api(baseUrl, token, "/calendar/events", {
      method: "POST",
      body: JSON.stringify({
        title: "Smoke Event",
        workCaseId: workCase.body.id,
        clientId,
        startAt: "2026-09-01T10:00:00.000Z",
        endAt: "2026-09-01T11:00:00.000Z",
        source: "manual",
        prerequisitesJson: [{ id: "client", label: "Client", required: true, passed: true }],
      }),
    });
    console.log("create CalendarEvent:", event.status, event.body?.status ?? event.body);
    if (event.status !== 201) throw new Error("CalendarEvent create failed");

    const submit = await api(baseUrl, token, `/calendar/events/${event.body.id}/submit-for-confirmation`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    console.log("submit for confirmation:", submit.status, submit.body?.mode ?? submit.body);
    if (submit.status !== 200) throw new Error("Submit failed");

    const decisions = await api(baseUrl, token, "/owner-decisions?status=pending");
    console.log("list owner decisions:", decisions.status, Array.isArray(decisions.body) ? decisions.body.length : decisions.body);
    if (decisions.status !== 200) throw new Error("List decisions failed");

    const decisionId = submit.body.decisionId as string;
    const approve = await api(baseUrl, token, `/owner-decisions/${decisionId}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    console.log("approve decision:", approve.status, approve.body?.executed ?? approve.body);
    if (approve.status !== 200) throw new Error("Approve failed");

    const timeline = await api(baseUrl, token, `/work-cases/${workCase.body.id}/timeline?limit=20`);
    console.log("work case timeline:", timeline.status, timeline.body?.items?.length ?? timeline.body);
    if (timeline.status !== 200) throw new Error("Timeline read failed");

    const confirmed = await api(baseUrl, token, `/calendar/events/${event.body.id}`);
    console.log("event after approve:", confirmed.status, confirmed.body?.status ?? confirmed.body);
    if (confirmed.body?.status !== "confirmed") throw new Error("Event not confirmed");
  });

  const fdrAfter = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "FinancialDocumentReview" WHERE "organizationId" = ${organizationId}
  `;
  console.log("FinancialDocumentReview delta:", Number(fdrAfter[0]?.count ?? 0) - Number(fdrBefore[0]?.count ?? 0));
  console.log("Google calls: none (smoke test uses services/routes only)");
  console.log("SMOKE TEST PASSED");
}

main()
  .catch((err) => {
    console.error("SMOKE TEST FAILED", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
