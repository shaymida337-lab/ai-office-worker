/**
 * READ-ONLY: Gmail integration + recent scan runs for Shay org.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW flag" }));
  process.exit(2);
}

const ORG_ID = "cmpjd7j7e0001bl5tzv049rxb";
const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
u.searchParams.set("connection_limit", "3");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

async function main() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const integrations = await prisma.integration.findMany({
    where: { organizationId: ORG_ID },
    select: {
      id: true,
      provider: true,
      expiresAt: true,
      connectedAt: true,
      updatedAt: true,
      accessToken: true,
      refreshToken: true,
      metadata: true,
    },
  });

  const safeIntegrations = integrations.map((i) => ({
    id: i.id,
    provider: i.provider,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    connectedAt: i.connectedAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    hasAccessToken: Boolean(i.accessToken),
    hasRefreshToken: Boolean(i.refreshToken),
    metadataKeys: i.metadata
      ? Object.keys(
          (() => {
            try {
              return JSON.parse(i.metadata);
            } catch {
              return {};
            }
          })()
        )
      : [],
  }));

  // Discover scan model via raw SQL if needed
  let scans: unknown = null;
  try {
    scans = await prisma.gmailScan.findMany({
      where: { organizationId: ORG_ID, startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
  } catch (e1) {
    try {
      scans = await prisma.$queryRaw`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name ILIKE '%scan%'
        ORDER BY table_name
      `;
    } catch (e2) {
      scans = { e1: String((e1 as Error).message), e2: String((e2 as Error).message) };
    }
  }

  // EmailMessage recent
  const emails = await prisma.emailMessage.findMany({
    where: { organizationId: ORG_ID, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      gmailId: true,
      subject: true,
      fromEmail: true,
      createdAt: true,
    },
  });

  // WhatsApp recent financial?
  let whatsapp: unknown = null;
  try {
    whatsapp = await prisma.whatsAppMessage.findMany({
      where: { organizationId: ORG_ID, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, direction: true, body: true, createdAt: true, status: true },
    });
  } catch (e) {
    whatsapp = { error: String((e as Error).message) };
  }

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        since: since.toISOString(),
        integrations: safeIntegrations,
        scans,
        emails: emails.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
        whatsapp,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => console.error(JSON.stringify({ error: String(e?.message ?? e) })))
  .finally(() => prisma.$disconnect());
