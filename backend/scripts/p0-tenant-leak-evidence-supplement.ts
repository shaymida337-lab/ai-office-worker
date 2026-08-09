/** Supplemental read-only scan: recent users + cross-org overlap with Shay org. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1" && !/localhost|127\.0\.0\.1/.test(prodUrl))) {
  console.error("Set ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}

const SHAY_EMAIL = "shaymida337@gmail.com";
const SHAY_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({ datasources: { db: { url: prodUrl } } });

function sha10(value: string | null | undefined) {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 10) : null;
}
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

async function main() {
  const recentUsers = await prisma.user.findMany({
    where: {
      createdAt: { gte: new Date("2026-07-01T00:00:00.000Z") },
      email: { not: SHAY_EMAIL },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { organization: true },
  });

  const enriched = [];
  for (const user of recentUsers) {
    const orgId = user.organization?.id;
    if (!orgId) {
      enriched.push({
        userId: user.id,
        email: maskEmail(user.email),
        createdAt: user.createdAt.toISOString(),
        organizationId: null,
      });
      continue;
    }

    const [gsi, fdr, inv, pay, overlapRows, memberships] = await Promise.all([
      prisma.gmailScanItem.count({ where: { organizationId: orgId } }),
      prisma.financialDocumentReview.count({ where: { organizationId: orgId } }),
      prisma.invoice.count({ where: { organizationId: orgId } }),
      prisma.supplierPayment.count({ where: { organizationId: orgId } }),
      prisma.$queryRawUnsafe<Array<{ c: number }>>(
        `SELECT COUNT(*)::int AS c
         FROM "GmailScanItem" g
         JOIN "GmailScanItem" s
           ON g."gmailMessageId" = s."gmailMessageId"
          AND g."organizationId" <> s."organizationId"
         WHERE g."organizationId" = $1
           AND s."organizationId" = $2
           AND g."gmailMessageId" IS NOT NULL`,
        orgId,
        SHAY_ORG,
      ),
      prisma.organizationMember.findMany({
        where: { userId: user.id },
        select: { organizationId: true, role: true, createdAt: true },
      }),
    ]);

    enriched.push({
      userId: user.id,
      email: maskEmail(user.email),
      createdAt: user.createdAt.toISOString(),
      organizationId: orgId,
      orgCreatedAt: user.organization!.createdAt.toISOString(),
      sameOrgAsShay: orgId === SHAY_ORG,
      memberships,
      counts: {
        gsi,
        fdr,
        inv,
        pay,
        totalFinancial: gsi + fdr + inv + pay,
        overlapGmailWithShay: overlapRows[0]?.c ?? 0,
      },
    });
  }

  const crossOrgGmailTop = (await prisma.$queryRawUnsafe<
    Array<{ gmailMessageId: string; org_count: number }>
  >(`
    SELECT "gmailMessageId", COUNT(DISTINCT "organizationId")::int AS org_count
    FROM "GmailScanItem"
    WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
    GROUP BY "gmailMessageId"
    HAVING COUNT(DISTINCT "organizationId") > 1
    ORDER BY org_count DESC
    LIMIT 20
  `)) as Array<{ gmailMessageId: string; org_count: number }>;

  const shayGmail = await prisma.integration.findFirst({
    where: { organizationId: SHAY_ORG, provider: "gmail" },
    select: { id: true, metadata: true, refreshToken: true, connectedAt: true },
  });

  let duplicateRefreshOrgs: Array<{ organizationId: string; integrationId: string }> = [];
  if (shayGmail?.refreshToken) {
    const dup = await prisma.integration.findMany({
      where: { provider: "gmail", refreshToken: shayGmail.refreshToken },
      select: { id: true, organizationId: true },
    });
    duplicateRefreshOrgs = dup.map((row) => ({ organizationId: row.organizationId, integrationId: row.id }));
  }

  const topCandidate = [...enriched]
    .filter((row) => row.organizationId)
    .sort((a, b) => {
      const aScore =
        (a.counts?.overlapGmailWithShay ?? 0) * 1000 + (a.counts?.totalFinancial ?? 0);
      const bScore =
        (b.counts?.overlapGmailWithShay ?? 0) * 1000 + (b.counts?.totalFinancial ?? 0);
      return bScore - aScore;
    })[0];

  console.log(
    JSON.stringify(
      {
        topCandidateByOverlapOrFinancialRows: topCandidate ?? null,
        recentUsersWithFinancialCounts: enriched,
        crossOrgGmailTop,
        shayGmailIntegration: shayGmail
          ? {
              integrationId: shayGmail.id,
              refreshTokenFingerprint: sha10(shayGmail.refreshToken),
              connectedAt: shayGmail.connectedAt?.toISOString() ?? null,
              duplicateRefreshTokenOrgCount: duplicateRefreshOrgs.length,
              duplicateOrgs: duplicateRefreshOrgs,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
