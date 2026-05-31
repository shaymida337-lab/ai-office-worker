import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const migrationName = "20260527161000_add_gmail_scan_items";

async function main() {
  console.log(`Read-only migration inspection for ${migrationName}`);
  console.log("No writes, schema changes, migrate commands, or resolve commands are executed.\n");

  const migrationRows = await prisma.$queryRawUnsafe(
    `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
     FROM "_prisma_migrations"
     WHERE migration_name = $1`,
    migrationName
  );

  const tableRows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('"GmailScanItem"') AS table_regclass`
  );

  const columnRows = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'GmailScanItem'
     ORDER BY ordinal_position`
  );

  const indexRows = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'GmailScanItem'
     ORDER BY indexname`
  );

  const constraintRows = await prisma.$queryRawUnsafe(
    `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid = to_regclass('"GmailScanItem"')
     ORDER BY conname`
  );

  printTable("MIGRATION ROW", migrationRows);
  printTable("TABLE EXISTS", tableRows);
  printTable("COLUMNS", columnRows);
  printTable("INDEXES", indexRows);
  printTable("FOREIGN KEYS / CONSTRAINTS", constraintRows);

  console.log("\nDecision rule:");
  console.log("- If GmailScanItem table, columns, indexes, and FK/constraints all exist: use --applied.");
  console.log("- If GmailScanItem table does not exist and columns/indexes/constraints are empty: use --rolled-back.");
  console.log("- If partially applied, stop and inspect manually before running any resolve command.");
}

function printTable(title, rows) {
  console.log(`\n=== ${title} ===`);
  if (Array.isArray(rows) && rows.length > 0) {
    console.table(rows);
  } else {
    console.log("(no rows)");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
