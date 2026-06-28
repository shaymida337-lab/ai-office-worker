/**
 * Applies Phase 11 org-level calendar engine flag columns locally/staging only.
 * Safe to re-run (uses IF NOT EXISTS).
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma.js";

const MIGRATION_NAME = "20260628120000_add_calendar_engine_org_flags";
const SQL_PATH = `prisma/migrations/${MIGRATION_NAME}/migration.sql`;

async function columnExists(column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Organization'
        AND column_name = ${column}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function main() {
  const required = [
    "calendar_engine_read_enabled",
    "calendar_engine_write_enabled",
    "calendar_engine_google_mirror_enabled",
    "calendar_engine_pilot_notes",
  ];

  const missing = [];
  for (const col of required) {
    const ok = await columnExists(col);
    console.log(`Organization.${col}: ${ok ? "OK" : "MISSING"}`);
    if (!ok) missing.push(col);
  }

  if (missing.length > 0) {
    const sql = readFileSync(join(process.cwd(), SQL_PATH), "utf8");
    await prisma.$executeRawUnsafe(sql);
    console.log(`Applied ${SQL_PATH}`);
  } else {
    console.log("Org flag columns already present — skipping SQL");
  }

  const recorded = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    WHERE migration_name = ${MIGRATION_NAME} AND finished_at IS NOT NULL
  `;
  if (Number(recorded[0]?.count ?? 0) === 0) {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ('${id}', '', NOW(), '${MIGRATION_NAME}', NULL, NULL, NOW(), 1)`
    );
    console.log(`Recorded ${MIGRATION_NAME} in _prisma_migrations`);
  }

  for (const col of required) {
    console.log(`Organization.${col}: ${(await columnExists(col)) ? "OK" : "MISSING"}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
