import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });

const orgId = process.argv[2] ?? "cmqxujfuj034ndy2czu9tjoko";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });

const logs = await prisma.syncLog.findMany({
  where: { organizationId: orgId, type: "gmail_scan" },
  orderBy: { startedAt: "desc" },
  take: 5,
  select: {
    id: true,
    scanMode: true,
    status: true,
    startedAt: true,
    finishedAt: true,
    emailsProcessed: true,
    emailsSaved: true,
    errorMessage: true,
  },
});
console.log(JSON.stringify(logs, null, 2));
await prisma.$disconnect();
