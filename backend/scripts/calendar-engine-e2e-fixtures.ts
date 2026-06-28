/**
 * Prepares JWT + fixture IDs for Playwright integration tests (E2E_INTEGRATION=1).
 * Requires migrated DB and CALENDAR_ENGINE_V1_READ/WRITE=true in backend .env.
 *
 * Usage:
 *   cd backend && npx tsx scripts/calendar-engine-e2e-fixtures.ts
 *   # copy E2E_TOKEN from output, then:
 *   cd frontend && E2E_INTEGRATION=1 E2E_TOKEN=... E2E_SKIP_WEBSERVER=1 npm run test:e2e:integration
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma.js";
import { signToken } from "../src/lib/auth.js";

process.env.CALENDAR_ENGINE_V1_READ = "true";
process.env.CALENDAR_ENGINE_V1_WRITE = "true";

async function ensureFixtures() {
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
    email = `calendar-e2e-${userId}@example.com`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, "createdAt", "updatedAt") VALUES ('${userId}', '${email}', 'Calendar E2E', NOW(), NOW())`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Organization" (id, "userId", name, "createdAt", "updatedAt") VALUES ('${organizationId}', '${userId}', 'Calendar E2E Org', NOW(), NOW())`
    );
  }

  const clients = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM "Client" WHERE "organizationId" = ${organizationId} AND "isActive" = true LIMIT 1
  `;

  let clientId = clients[0]?.id;
  let clientName = clients[0]?.name;
  if (!clientId) {
    clientId = randomUUID();
    clientName = "לקוח E2E";
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Client" (id, "organizationId", name, email, "isActive", "createdAt", "updatedAt")
       VALUES ('${clientId}', '${organizationId}', '${clientName}', 'e2e-${clientId}@example.com', true, NOW(), NOW())`
    );
  }

  return { userId, email, organizationId, clientId, clientName };
}

async function main() {
  const { userId, email, organizationId, clientId, clientName } = await ensureFixtures();
  const token = signToken({ userId, organizationId, email });

  console.log("Calendar Engine E2E fixtures ready.");
  console.log(`E2E_TOKEN=${token}`);
  console.log(`E2E_ORG_ID=${organizationId}`);
  console.log(`E2E_CLIENT_ID=${clientId}`);
  console.log(`E2E_CLIENT_NAME=${clientName}`);
  console.log("");
  console.log("Backend flags (must be true):");
  console.log(`  CALENDAR_ENGINE_V1_READ=${process.env.CALENDAR_ENGINE_V1_READ}`);
  console.log(`  CALENDAR_ENGINE_V1_WRITE=${process.env.CALENDAR_ENGINE_V1_WRITE}`);
  console.log("");
  console.log("Frontend flags (must be true when starting dev server):");
  console.log("  NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ=true");
  console.log("  NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE=true");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
