/**
 * READ-ONLY: SyncLog + Integration for Shay (no secrets).
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
  console.error(JSON.stringify({ error: "need PROD + ALLOW" }));
  process.exit(2);
}

const ORG_ID = "cmpjd7j7e0001bl5tzv049rxb";
const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
u.searchParams.set("connection_limit", "3");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

async function main() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const syncLogs = await prisma.syncLog.findMany({
    where: { organizationId: ORG_ID, startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 30,
  });

  const integrations = await prisma.integration.findMany({
    where: { organizationId: ORG_ID },
    select: {
      provider: true,
      expiresAt: true,
      connectedAt: true,
      updatedAt: true,
      accessToken: true,
      refreshToken: true,
    },
  });

  // recent FDR/GSI any status last 7d count by source
  const bySource = await prisma.financialDocumentReview.groupBy({
    by: ["source"],
    where: { organizationId: ORG_ID, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    _count: true,
  });

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        since: since.toISOString(),
        integrations: integrations.map((i) => ({
          provider: i.provider,
          expiresAt: i.expiresAt?.toISOString() ?? null,
          connectedAt: i.connectedAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
          hasAccessToken: Boolean(i.accessToken),
          hasRefreshToken: Boolean(i.refreshToken),
          tokenExpired: i.expiresAt ? i.expiresAt.getTime() < Date.now() : null,
        })),
        syncLogs: syncLogs.map((s) => ({
          id: s.id,
          type: s.type,
          status: s.status,
          emailsProcessed: s.emailsProcessed,
          emailsSaved: s.emailsSaved,
          invoicesFound: s.invoicesFound,
          errorsCount: s.errorsCount,
          errorMessage: s.errorMessage,
          scanMode: s.scanMode,
          windowTruncated: s.windowTruncated,
          totalMatched: s.totalMatched,
          startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
          finishedAt: s.finishedAt ? new Date(s.finishedAt).toISOString() : null,
        })),
        fdrBySourceLast7d: bySource,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => console.error(JSON.stringify({ error: String(e?.message ?? e) })))
  .finally(() => prisma.$disconnect());
