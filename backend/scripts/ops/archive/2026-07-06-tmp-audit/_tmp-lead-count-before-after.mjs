/**
 * Compare old vs new stale-lead counts (read-only).
 */
import { config } from "dotenv";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { buildRealStaleLeadWhere } from "../src/services/crm/leadQuality.ts";

config({ path: join(process.cwd(), ".env.prod.local") });
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;

const orgId = process.argv[2] ?? "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient();
const staleBefore = new Date(Date.now() - 48 * 60 * 60 * 1000);

const oldWhere = {
  organizationId: orgId,
  repliedAt: null,
  stage: { notIn: ["סגור", "הפסד"] },
  OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleBefore } }],
};

const [oldCount, newCount] = await Promise.all([
  prisma.lead.count({ where: oldWhere }),
  prisma.lead.count({ where: buildRealStaleLeadWhere(orgId, staleBefore) }),
]);

console.log(JSON.stringify({ organizationId: orgId, before: oldCount, after: newCount }, null, 2));
await prisma.$disconnect();
