/** Read-only: orgs in cross-org Gmail clusters + Shay org financial summary. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") process.exit(1);

const SHAY_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

async function main() {
  const orgsInCrossOrg = await prisma.$queryRawUnsafe<Array<{ organizationId: string; gmail_rows: number }>>(`
    SELECT g."organizationId", COUNT(*)::int AS gmail_rows
    FROM "GmailScanItem" g
    WHERE g."gmailMessageId" IN (
      SELECT "gmailMessageId"
      FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    )
    GROUP BY g."organizationId"
    ORDER BY gmail_rows DESC
  `);

  const orgDetails = await Promise.all(
    orgsInCrossOrg.map(async (row) => {
      const org = await prisma.organization.findUnique({
        where: { id: row.organizationId },
        select: { id: true, name: true, createdAt: true, user: { select: { id: true, email: true, createdAt: true } } },
      });
      return {
        organizationId: row.organizationId,
        gmailRowsInCrossOrgCluster: row.gmail_rows,
        orgName: org?.name ?? null,
        ownerUserId: org?.user?.id ?? null,
        ownerEmailMasked: org?.user?.email ? `${org.user.email.slice(0, 2)}***@${org.user.email.split("@")[1]}` : null,
        orgCreatedAt: org?.createdAt?.toISOString() ?? null,
        isShayOrg: row.organizationId === SHAY_ORG,
      };
    }),
  );

  const shayCounts = {
    gsi: await prisma.gmailScanItem.count({ where: { organizationId: SHAY_ORG } }),
    fdr: await prisma.financialDocumentReview.count({ where: { organizationId: SHAY_ORG } }),
    inv: await prisma.invoice.count({ where: { organizationId: SHAY_ORG } }),
    pay: await prisma.supplierPayment.count({ where: { organizationId: SHAY_ORG } }),
  };

  const realEmailRecentUsers = await prisma.user.findMany({
    where: {
      createdAt: { gte: new Date("2026-06-20T00:00:00.000Z") },
      email: { notIn: ["shaymida337@gmail.com"] },
      NOT: [{ email: { endsWith: "@example.com" } }, { email: { endsWith: "@temp.invalid" } }],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { organization: true },
  });

  console.log(
    JSON.stringify(
      {
        shayOrgId: SHAY_ORG,
        shayFinancialCounts: shayCounts,
        orgsParticipatingInCrossOrgGmailClusters: orgDetails,
        realEmailRecentUsers: realEmailRecentUsers.map((u) => ({
          userId: u.id,
          emailMasked: `${u.email.slice(0, 2)}***@${u.email.split("@")[1]}`,
          createdAt: u.createdAt.toISOString(),
          organizationId: u.organization?.id ?? null,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .finally(async () => prisma.$disconnect());
