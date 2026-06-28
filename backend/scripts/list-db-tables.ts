import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  console.log(tables.map((t) => t.table_name).join("\n"));
}

main().finally(() => prisma.$disconnect());
