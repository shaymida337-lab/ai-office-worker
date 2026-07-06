/**
 * READ-ONLY: lists junk auto-email leads and proposes a safe close plan.
 * Does NOT mutate data.
 *
 * Usage:
 *   node scripts/junk-leads-cleanup-plan.mjs [organizationId]
 */
import { config } from "dotenv";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local") });
if (process.env.PROD_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
}

const orgId = process.argv[2] ?? "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient();

const junkWhere = {
  organizationId: orgId,
  source: "email",
  stage: { notIn: ["סגור", "הפסד"] },
  assignedTo: null,
  NOT: { tags: { has: "qualified" } },
};

const rows = await prisma.lead.findMany({
  where: junkWhere,
  select: {
    id: true,
    name: true,
    email: true,
    source: true,
    stage: true,
    createdAt: true,
    lastContactAt: true,
    tags: true,
  },
  orderBy: { createdAt: "desc" },
});

const ids = rows.map((row) => row.id);

console.log(
  JSON.stringify(
    {
      organizationId: orgId,
      junkLeadCount: rows.length,
      leads: rows,
      recommendation: {
        action: "mark_as_lost_do_not_delete",
        stage: "הפסד",
        tagToAdd: "junk_auto_email",
        timelineNote: "סומן אוטומטית כליד לא רלוונטי (ייבוא מייל) — ניקוי נתונים",
      },
      safePrismaUpdate: {
        description: "Run only after manual review in staging. Updates stage to הפסד and tags junk_auto_email.",
        where: { id: { in: ids } },
        data: {
          stage: "הפסד",
          tags: { set: ["junk_auto_email"] },
        },
      },
      safeSqlPreview: `-- Review first: SELECT id, name, email FROM "Lead" WHERE id IN (${ids.map((id) => `'${id}'`).join(", ") || "''"});
-- UPDATE "Lead"
-- SET stage = 'הפסד', tags = ARRAY['junk_auto_email'], "updatedAt" = NOW()
-- WHERE "organizationId" = '${orgId}'
--   AND source = 'email'
--   AND stage NOT IN ('סגור', 'הפסד')
--   AND "assignedTo" IS NULL
--   AND NOT ('qualified' = ANY(tags));`,
    },
    null,
    2
  )
);

await prisma.$disconnect();
