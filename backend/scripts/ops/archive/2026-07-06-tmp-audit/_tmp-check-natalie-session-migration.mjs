import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  config({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL / PROD_DATABASE_URL");
  process.exit(2);
}

const isLocal = /localhost|127\.0\.0\.1/.test(url);
const migrationName = "20260702153000_add_natalie_conversation_session";
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const mig = await prisma.$queryRawUnsafe(
    `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
     FROM "_prisma_migrations"
     WHERE migration_name = $1`,
    migrationName
  );
  const table = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."NatalieConversationSession"')::text AS regclass`
  );
  const recent = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at
     FROM "_prisma_migrations"
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 8`
  );
  console.log(
    JSON.stringify(
      {
        target: isLocal ? "local" : "remote",
        migrationName,
        migrationApplied: Array.isArray(mig) && mig.length > 0,
        migrationRow: mig,
        tableExists: table?.[0]?.regclass != null,
        tableRegclass: table?.[0]?.regclass ?? null,
        recentMigrations: recent,
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
