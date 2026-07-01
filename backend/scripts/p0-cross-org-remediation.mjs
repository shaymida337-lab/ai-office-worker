/**
 * P0-001/P0-002: Apply approved cross-org quarantine for שרון (Phase C2 allowlist-aware).
 *
 * Dry-run (default): BEGIN … ROLLBACK
 * Execute: pass --execute to COMMIT
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const organizationId = args[0] ?? "cmqxujfuj034ndy2czu9tjoko";
const execute = process.argv.includes("--execute");
const sqlPath = join(process.cwd(), "scripts", "phase-c2-quarantine-dry-run.sql");

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

async function execStatements(sql) {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const parts = stripped
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    await prisma.$executeRawUnsafe(part);
  }
}

async function contaminationCounts(orgId) {
  const [row] = await prisma.$queryRawUnsafe(`
    WITH contaminated_ids AS (
      SELECT "gmailMessageId" AS gmail_id
      FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    )
    SELECT
      (SELECT COUNT(*)::int FROM contaminated_ids) AS global_cross_org_gmail_ids,
      (SELECT COUNT(*)::int FROM "GmailScanItem" g
        INNER JOIN contaminated_ids c ON c.gmail_id = g."gmailMessageId"
        WHERE g."organizationId" = $1 AND g."reviewStatus" <> 'rejected') AS active_gsi,
      (SELECT COUNT(*)::int FROM "FinancialDocumentReview" f
        INNER JOIN contaminated_ids c ON c.gmail_id = f."gmailMessageId"
        WHERE f."organizationId" = $1 AND f."reviewStatus" NOT IN ('rejected')) AS active_fdr
  `, orgId);
  return row;
}

async function main() {
  const dryRunSql = readFileSync(sqlPath, "utf8").replaceAll(
    "'cmqxujfuj034ndy2czu9tjoko'",
    `'${organizationId}'`
  );

  const before = await contaminationCounts(organizationId);
  await prisma.$executeRawUnsafe("BEGIN");
  try {
    await execStatements(dryRunSql);
    const updateCounts = await prisma.$queryRawUnsafe(`SELECT * FROM phase_c2_update_counts ORDER BY entity`);
    const after = await contaminationCounts(organizationId);
    if (execute) {
      await prisma.$executeRawUnsafe("COMMIT");
    } else {
      await prisma.$executeRawUnsafe("ROLLBACK");
    }
    console.log(
      JSON.stringify(
        {
          mode: execute ? "execute" : "dry-run",
          organizationId,
          before,
          updateCounts,
          after,
          committed: execute,
        },
        (_key, value) => (typeof value === "bigint" ? Number(value) : value),
        2
      )
    );
  } catch (error) {
    await prisma.$executeRawUnsafe("ROLLBACK");
    throw error;
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
