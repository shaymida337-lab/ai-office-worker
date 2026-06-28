import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const gmail = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'GmailScanItem'
    ) AS exists
  `;
  const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 10
  `;
  console.log(JSON.stringify({ gmailScanItemExists: gmail[0]?.exists, recentMigrations: applied }, null, 2));
}

main()
  .finally(() => prisma.$disconnect());
