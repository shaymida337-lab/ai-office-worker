/**
 * P0-003: Dedup existing twin SupplierPayment rows (same org + gmail source).
 * Keeps oldest active row; marks duplicates needs_review + duplicateDetected.
 *
 * Dry-run default. Pass --execute to COMMIT.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ALLOWLISTED_GMAIL_IDS = new Set([
  "19eac05f383d017b",
  "19f1c987ae04f50b",
  "19ed3a45ad6c0c41",
  "19ed4213bdd6e726",
  "19ebfbbfb5c8e626",
]);
const execute = process.argv.includes("--execute");
const organizationId = process.argv.find((arg) => arg.startsWith("org="))?.slice(4) ?? null;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  const twins = await prisma.$queryRawUnsafe(`
    SELECT sp."organizationId", e."gmailId" AS gmail_message_id,
           array_agg(sp.id ORDER BY sp."createdAt" ASC) AS payment_ids,
           COUNT(*)::int AS cnt
    FROM "SupplierPayment" sp
    INNER JOIN "EmailMessage" e ON e.id = sp."emailMessageId" AND e."organizationId" = sp."organizationId"
    WHERE sp."approvalStatus" <> 'rejected'
      ${organizationId ? `AND sp."organizationId" = '${organizationId}'` : ""}
    GROUP BY sp."organizationId", e."gmailId"
    HAVING COUNT(*) > 1
  `);

  const actions = [];
  for (const row of twins) {
    if (ALLOWLISTED_GMAIL_IDS.has(row.gmail_message_id)) continue;
    const ids = row.payment_ids;
    const keepId = ids[0];
    for (const duplicateId of ids.slice(1)) {
      actions.push({ keepId, duplicateId, gmailMessageId: row.gmail_message_id, organizationId: row.organizationId });
    }
  }

  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", twinGroups: twins.length, actions }, null, 2));

  if (!execute || !actions.length) {
    await prisma.$disconnect();
    return;
  }

  for (const action of actions) {
    await prisma.supplierPayment.update({
      where: { id: action.duplicateId },
      data: {
        approvalStatus: "needs_review",
        duplicateDetected: true,
        duplicateReason: `p0_duplicate_source_dedup_kept:${action.keepId}`,
      },
    });
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
