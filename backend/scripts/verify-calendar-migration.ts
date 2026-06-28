import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'WorkCase',
        'CalendarEvent',
        'CalendarEventAudit',
        'WorkCaseTimelineEntry',
        'OwnerDecisionQueueItem'
      )
    ORDER BY table_name
  `;

  const taskCols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Task'
      AND column_name IN ('workCaseId', 'calendarEventId')
    ORDER BY column_name
  `;

  const orgCol = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Organization'
      AND column_name = 'calendar_autonomy_json'
  `;

  const failed = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
  >`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL
    ORDER BY started_at DESC
    LIMIT 5
  `;

  const orgFlagCols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Organization'
      AND column_name IN (
        'calendar_engine_read_enabled',
        'calendar_engine_write_enabled',
        'calendar_engine_google_mirror_enabled',
        'calendar_engine_pilot_notes'
      )
    ORDER BY column_name
  `;

  console.log(JSON.stringify({ tables, taskCols, orgCol, orgFlagCols, failed }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
