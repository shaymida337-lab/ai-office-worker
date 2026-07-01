/**
 * SELECT-only audit for Gmail ingestion cross-org contamination.
 * Usage: DATABASE_URL=... node backend/scripts/gmail-isolation-audit.mjs
 *        (also accepts PROD_DATABASE_URL from env)
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set DATABASE_URL or PROD_DATABASE_URL");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

async function duplicateGmailIds(table, idColumn) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "${idColumn}" AS gmail_id, COUNT(DISTINCT "organizationId") AS org_count,
           array_agg(DISTINCT "organizationId") AS org_ids
    FROM "${table}"
    WHERE "${idColumn}" IS NOT NULL AND "${idColumn}" <> ''
    GROUP BY "${idColumn}"
    HAVING COUNT(DISTINCT "organizationId") > 1
    ORDER BY org_count DESC
    LIMIT 50
  `);
  const total = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT "${idColumn}"
      FROM "${table}"
      WHERE "${idColumn}" IS NOT NULL AND "${idColumn}" <> ''
      GROUP BY "${idColumn}"
      HAVING COUNT(DISTINCT "organizationId") > 1
    ) t
  `);
  return { sample: rows, duplicateMessageCount: total[0]?.cnt ?? 0 };
}

async function contaminatedRowCounts() {
  const tables = [
    { table: "GmailScanItem", column: "gmailMessageId" },
    { table: "FinancialDocumentReview", column: "gmailMessageId" },
    { table: "EmailMessage", column: "gmailId" },
  ];
  const out = {};
  for (const { table, column } of tables) {
    const dup = await duplicateGmailIds(table, column);
    const totalRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "${table}" t
      WHERE EXISTS (
        SELECT 1 FROM "${table}" t2
        WHERE t2."${column}" = t."${column}"
          AND t2."organizationId" <> t."organizationId"
          AND t."${column}" IS NOT NULL AND t."${column}" <> ''
      )
    `);
    out[table] = {
      duplicateGmailIds: dup.duplicateMessageCount,
      contaminatedRows: totalRows[0]?.cnt ?? 0,
      topExamples: dup.sample.slice(0, 5),
    };
  }
  return out;
}

async function sharedRefreshTokens() {
  const integrations = await prisma.integration.findMany({
    where: { provider: "gmail", refreshToken: { not: null } },
    select: {
      id: true,
      organizationId: true,
      refreshToken: true,
      connectedAt: true,
      organization: { select: { name: true, user: { select: { email: true } } } },
    },
  });

  const byHash = new Map();
  for (const row of integrations) {
    const hash = hashToken(row.refreshToken);
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(row);
  }

  const shared = [...byHash.entries()].filter(([, rows]) => rows.length > 1);
  return {
    totalGmailIntegrations: integrations.length,
    sharedTokenGroups: shared.length,
    groups: shared.map(([hash, rows]) => ({
      tokenHashPrefix: hash,
      orgCount: rows.length,
      organizations: rows.map((r) => ({
        organizationId: r.organizationId,
        orgName: r.organization?.name,
        userEmail: r.organization?.user?.email,
        connectedAt: r.connectedAt,
      })),
    })),
  };
}

function jsonPrint(value) {
  console.log(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v), 2));
}

async function main() {
  const source = process.env.PROD_DATABASE_URL
    ? "PROD_DATABASE_URL"
    : process.env.DATABASE_URL
      ? "DATABASE_URL"
      : "unknown";
  console.log(`=== Gmail ingestion isolation audit (SELECT only, source=${source}) ===\n`);

  const orgCount = await prisma.organization.count();
  const gsiCount = await prisma.gmailScanItem.count();
  const integrationCount = await prisma.integration.count({ where: { provider: "gmail" } });
  console.log(`Organizations: ${orgCount}, GmailScanItems: ${gsiCount}, Gmail integrations: ${integrationCount}\n`);

  const contamination = await contaminatedRowCounts();
  console.log("--- Cross-org duplicate gmailMessageId / gmailId ---");
  jsonPrint(contamination);

  console.log("\n--- Shared Gmail refresh tokens across organizations ---");
  const tokens = await sharedRefreshTokens();
  jsonPrint(tokens);

  console.log("\n--- Contaminated rows by organization (GmailScanItem) ---");
  const perOrg = await prisma.$queryRawUnsafe(`
    SELECT t."organizationId", COUNT(*)::int AS contaminated_rows
    FROM "GmailScanItem" t
    WHERE EXISTS (
      SELECT 1 FROM "GmailScanItem" t2
      WHERE t2."gmailMessageId" = t."gmailMessageId"
        AND t2."organizationId" <> t."organizationId"
    )
    GROUP BY t."organizationId"
    ORDER BY contaminated_rows DESC
  `);
  jsonPrint(perOrg);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
