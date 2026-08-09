import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}
const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const ORG = "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({ datasources: { db: { url } } });
const staleBefore = new Date(Date.now() - 48 * 60 * 60 * 1000);

const [tasksOpen, crmOpenReminders, crmUnattended] = await Promise.all([
  prisma.task.count({ where: { organizationId: ORG, status: "open" } }),
  prisma.lead.count({ where: { organizationId: ORG, nextReminderAt: { not: null } } }),
  prisma.lead.count({
    where: {
      organizationId: ORG,
      OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleBefore } }],
    },
  }),
]);

console.log(JSON.stringify({ tasksOpen, crmOpenReminders, crmUnattended }, null, 2));
await prisma.$disconnect();
