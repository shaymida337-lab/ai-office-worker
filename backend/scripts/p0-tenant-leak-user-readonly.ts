import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(".env.prod.local")) loadEnv({ path: ".env.prod.local", override: false });
if (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") process.exit(1);

const SHAY_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const USER_ID = process.argv[2] ?? "cmqw27e43002am92bl8e6c9a9";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });

async function main() {
const user = await prisma.user.findUnique({ where: { id: USER_ID }, include: { organization: true } });
const orgId = user?.organization?.id;
const memberships = await prisma.organizationMember.findMany({ where: { userId: USER_ID } });
const sample = orgId
  ? await prisma.gmailScanItem.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, organizationId: true, gmailMessageId: true, supplierName: true, amount: true, createdAt: true },
    })
  : [];
const overlap = orgId
  ? await prisma.$queryRawUnsafe<Array<{ id: string; gmailMessageId: string; organizationId: string }>>(
      `SELECT g.id, g."gmailMessageId", g."organizationId"
       FROM "GmailScanItem" g
       JOIN "GmailScanItem" s ON g."gmailMessageId" = s."gmailMessageId" AND g."organizationId" <> s."organizationId"
       WHERE g."organizationId" = $1 AND s."organizationId" = $2
       LIMIT 10`,
      orgId,
      SHAY_ORG,
    )
  : [];

console.log(
  JSON.stringify(
    {
      userId: user?.id,
      emailMasked: user?.email ? `${user.email.slice(0, 2)}***@${user.email.split("@")[1]}` : null,
      createdAt: user?.createdAt.toISOString(),
      organizationId: orgId,
      organizationCreatedAt: user?.organization?.createdAt.toISOString(),
      sameOrgAsShay: orgId === SHAY_ORG,
      memberships,
      sampleGsiRows: sample.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        gmailMessageId: r.gmailMessageId,
        supplierMasked: r.supplierName?.slice(0, 24) ?? null,
        amount: r.amount,
        createdAt: r.createdAt.toISOString(),
      })),
      overlapRowsWithShayOrg: overlap,
    },
    null,
    2,
  ),
);
}

main().finally(async () => prisma.$disconnect());
