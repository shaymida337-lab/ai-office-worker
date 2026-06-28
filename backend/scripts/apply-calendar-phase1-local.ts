import "dotenv/config";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma.js";

function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutComments
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function runSqlFile(relativePath: string) {
  const sql = readFileSync(join(process.cwd(), relativePath), "utf8");
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(`${statement};`);
  }
  console.log(`Applied SQL file: ${relativePath} (${statements.length} statements)`);
}

async function main() {
  if (!(await tableExists("Service"))) {
    await runSqlFile("prisma/migrations/20260621140000_add_appointments_and_services/migration.sql");
  } else {
    console.log("Service table already exists — skipping appointments/services migration");
  }

  if (await tableExists("WorkCase")) {
    console.log("Calendar engine tables already exist — skipping Phase 1 migration");
  } else {
    // Remove stale migration record if a prior dry-run recorded without applying SQL.
    await prisma.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = '20260625120000_add_calendar_engine_phase1'`
    );
    await runSqlFile("prisma/migrations/20260625120000_add_calendar_engine_phase1/migration.sql");
  }

  for (const table of [
    "WorkCase",
    "CalendarEvent",
    "CalendarEventAudit",
    "WorkCaseTimelineEntry",
    "OwnerDecisionQueueItem",
  ]) {
    console.log(`${table}: ${(await tableExists(table)) ? "OK" : "MISSING"}`);
  }

  const taskCols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Task' AND column_name IN ('workCaseId', 'calendarEventId')
    ORDER BY column_name
  `;
  console.log("Task columns:", taskCols.map((r) => r.column_name).join(", ") || "MISSING");

  const orgCol = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Organization' AND column_name = 'calendar_autonomy_json'
  `;
  console.log("Organization.calendar_autonomy_json:", orgCol.length ? "OK" : "MISSING");

  const existing = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    WHERE migration_name = '20260625120000_add_calendar_engine_phase1' AND finished_at IS NOT NULL
  `;
  if (Number(existing[0]?.count ?? 0) === 0) {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ('${id}', '', NOW(), '20260625120000_add_calendar_engine_phase1', NULL, NULL, NOW(), 1)`
    );
    console.log("Recorded Phase 1 migration in _prisma_migrations");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
