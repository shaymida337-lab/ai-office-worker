import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const orgCols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Organization' ORDER BY column_name
  `;
  console.log("Organization columns:", orgCols.map((c) => c.column_name).join(", "));

  const org = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Organization" LIMIT 1`;
  console.log("sample org:", org[0]?.id ?? "none");
}

main().finally(() => prisma.$disconnect());
