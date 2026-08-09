/**
 * P0 tenant leak — read-only production evidence collector.
 *
 * Usage (Render Shell or local with prod creds):
 *   ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/p0-tenant-leak-evidence-readonly.ts
 *   ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/p0-tenant-leak-evidence-readonly.ts --user-email new@example.com
 *
 * No writes. No deletes. No session invalidation.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const prodUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(prodUrl);
if (!prodUrl) {
  console.error("PROD_DATABASE_URL / DATABASE_URL missing");
  process.exit(1);
}
if (!isLocal && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("Remote DB blocked. Set ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}

const SHAY_EMAIL = "shaymida337@gmail.com";
const SHAY_ORG_HINTS = ["cmpjd7j7e0001bl5tzv049rxb", "cmqxujfuj034ndy2czu9tjoko"];

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const TARGET_EMAIL = argValue("--user-email")?.trim().toLowerCase();

function sha10(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}***@${domain}`;
}

function truncate(value: string | null | undefined, max = 24): string | null {
  if (!value) return null;
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function parseMeta(metadata: unknown): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === "object" && metadata !== null) return metadata as Record<string, unknown>;
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

const prisma = new PrismaClient({
  datasources: { db: { url: prodUrl } },
});

type DocRow = {
  kind: "invoice" | "gmail_scan_item" | "financial_document_review" | "supplier_payment";
  id: string;
  organizationId: string;
  gmailMessageId: string | null;
  supplierMasked: string | null;
  amount: number | null;
  createdAt: Date;
  source: string | null;
  integrationId: string | null;
};

async function loadFinancialRowsForOrg(organizationId: string, limit = 50): Promise<DocRow[]> {
  const [invoices, gsi, reviews, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        gmailMessageId: true,
        supplierName: true,
        amount: true,
        createdAt: true,
        fromEmail: true,
      },
    }),
    prisma.gmailScanItem.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        gmailMessageId: true,
        supplierName: true,
        amount: true,
        createdAt: true,
        emailMessageId: true,
      },
    }),
    prisma.financialDocumentReview.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        gmailMessageId: true,
        supplierName: true,
        totalAmount: true,
        createdAt: true,
        source: true,
      },
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        emailMessageId: true,
        supplierName: true,
        amount: true,
        createdAt: true,
        source: true,
      },
    }),
  ]);

  const emailMessageIds = payments.map((p) => p.emailMessageId).filter((id): id is string => Boolean(id));
  const emailMessages =
    emailMessageIds.length > 0
      ? await prisma.emailMessage.findMany({
          where: { id: { in: emailMessageIds } },
          select: { id: true, gmailId: true },
        })
      : [];
  const gmailByEmailMessageId = new Map(emailMessages.map((row) => [row.id, row.gmailId]));

  return [
    ...invoices.map((row) => ({
      kind: "invoice" as const,
      id: row.id,
      organizationId: row.organizationId,
      gmailMessageId: row.gmailMessageId,
      supplierMasked: truncate(row.supplierName ?? row.fromEmail),
      amount: row.amount,
      createdAt: row.createdAt,
      source: "invoice",
      integrationId: null,
    })),
    ...gsi.map((row) => ({
      kind: "gmail_scan_item" as const,
      id: row.id,
      organizationId: row.organizationId,
      gmailMessageId: row.gmailMessageId,
      supplierMasked: truncate(row.supplierName),
      amount: row.amount,
      createdAt: row.createdAt,
      source: `gmail_scan_item:${row.emailMessageId ?? "none"}`,
      integrationId: null,
    })),
    ...reviews.map((row) => ({
      kind: "financial_document_review" as const,
      id: row.id,
      organizationId: row.organizationId,
      gmailMessageId: row.gmailMessageId,
      supplierMasked: truncate(row.supplierName),
      amount: row.totalAmount,
      createdAt: row.createdAt,
      source: row.source,
      integrationId: null,
    })),
    ...payments.map((row) => ({
      kind: "supplier_payment" as const,
      id: row.id,
      organizationId: row.organizationId,
      gmailMessageId: row.emailMessageId ? gmailByEmailMessageId.get(row.emailMessageId) ?? null : null,
      supplierMasked: truncate(row.supplierName),
      amount: row.amount,
      createdAt: row.createdAt,
      source: row.source,
      integrationId: null,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function emailMessageIdsForGmail(gmailIds: string[]): Promise<string[]> {
  if (gmailIds.length === 0) return [];
  const rows = await prisma.emailMessage.findMany({
    where: { gmailId: { in: gmailIds } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function crossOrgRowsForGmailIds(gmailIds: string[]) {
  if (gmailIds.length === 0) return [];
  const unique = [...new Set(gmailIds.filter(Boolean))];
  const paymentEmailMessageIds = await emailMessageIdsForGmail(unique);
  const paymentEmailMessages =
    paymentEmailMessageIds.length > 0
      ? await prisma.emailMessage.findMany({
          where: { id: { in: paymentEmailMessageIds } },
          select: { id: true, gmailId: true },
        })
      : [];
  const gmailIdByEmailMessageId = new Map(paymentEmailMessages.map((row) => [row.id, row.gmailId]));

  const [gsi, reviews, payments, invoices] = await Promise.all([
    prisma.gmailScanItem.findMany({
      where: { gmailMessageId: { in: unique } },
      select: { id: true, organizationId: true, gmailMessageId: true, createdAt: true },
    }),
    prisma.financialDocumentReview.findMany({
      where: { gmailMessageId: { in: unique } },
      select: { id: true, organizationId: true, gmailMessageId: true, createdAt: true },
    }),
    prisma.supplierPayment.findMany({
      where: { emailMessageId: { in: paymentEmailMessageIds } },
      select: { id: true, organizationId: true, emailMessageId: true, createdAt: true },
    }),
    prisma.invoice.findMany({
      where: { gmailMessageId: { in: unique } },
      select: { id: true, organizationId: true, gmailMessageId: true, createdAt: true },
    }),
  ]);

  const orgIds = [...new Set([...gsi, ...reviews, ...payments, ...invoices].map((r) => r.organizationId))];
  const integrations = orgIds.length
    ? await prisma.integration.findMany({
        where: { organizationId: { in: orgIds }, provider: "gmail" },
        select: { id: true, organizationId: true, refreshToken: true, metadata: true, connectedAt: true },
      })
    : [];

  const integrationByOrg = new Map(integrations.map((row) => [row.organizationId, row]));

  return unique.flatMap((gmailMessageId) => {
    const rows = [
      ...gsi.filter((r) => r.gmailMessageId === gmailMessageId).map((r) => ({ ...r, kind: "gmail_scan_item" as const })),
      ...reviews.filter((r) => r.gmailMessageId === gmailMessageId).map((r) => ({ ...r, kind: "financial_document_review" as const })),
      ...payments
        .filter((r) => r.emailMessageId && gmailIdByEmailMessageId.get(r.emailMessageId) === gmailMessageId)
        .map((r) => ({ ...r, gmailMessageId, kind: "supplier_payment" as const })),
      ...invoices.filter((r) => r.gmailMessageId === gmailMessageId).map((r) => ({ ...r, kind: "invoice" as const })),
    ];
    return rows.map((row) => {
      const integration = integrationByOrg.get(row.organizationId);
      const meta = parseMeta(integration?.metadata);
      return {
        gmailMessageId,
        organizationId: row.organizationId,
        kind: row.kind,
        recordId: row.id,
        createdAt: row.createdAt.toISOString(),
        integrationId: integration?.id ?? null,
        gmailAccountEmail: typeof meta.googleAccountEmail === "string" ? maskEmail(meta.googleAccountEmail.toLowerCase()) : null,
        refreshTokenFingerprint: sha10(integration?.refreshToken),
      };
    });
  });
}

async function main() {
  console.log(JSON.stringify({ mode: "read_only", host: prodUrl.replace(/\/\/.*@/, "//***@"), generatedAt: new Date().toISOString() }, null, 2));

  const shayUser = await prisma.user.findUnique({
    where: { email: SHAY_EMAIL },
    include: { organization: true },
  });

  const recentUsers = await prisma.user.findMany({
    where: TARGET_EMAIL
      ? { email: TARGET_EMAIL }
      : {
          createdAt: { gte: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000) },
          NOT: { email: SHAY_EMAIL },
        },
    orderBy: { createdAt: "desc" },
    take: TARGET_EMAIL ? 1 : 8,
    include: { organization: true },
  });

  const candidate =
    recentUsers.find((user) => user.organization && user.email !== SHAY_EMAIL) ?? recentUsers[0] ?? null;

  if (!candidate?.organization) {
    console.log(JSON.stringify({ error: "No candidate user with organization found", recentUserCount: recentUsers.length }, null, 2));
    process.exit(1);
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: candidate.id },
    select: { id: true, organizationId: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const shayOrgId = shayUser?.organization?.id ?? null;
  const financialRows = await loadFinancialRowsForOrg(candidate.organization.id, 40);
  const gmailIds = financialRows.map((row) => row.gmailMessageId).filter((id): id is string => Boolean(id));
  const crossOrg = await crossOrgRowsForGmailIds(gmailIds.slice(0, 25));

  const overlapWithShayGmailIds =
    shayOrgId && gmailIds.length
      ? await prisma.gmailScanItem.findMany({
          where: { organizationId: shayOrgId, gmailMessageId: { in: gmailIds } },
          select: { id: true, gmailMessageId: true, createdAt: true },
          take: 20,
        })
      : [];

  const authAudits = await prisma.platformAuditLog.findMany({
    where: {
      OR: [
        { entityId: candidate.id, action: { in: ["user_login", "organization_created"] } },
        { organizationId: candidate.organization.id, action: { in: ["user_login", "organization_created"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      createdAt: true,
      action: true,
      organizationId: true,
      entityType: true,
      entityId: true,
      metadata: true,
      sourceRoute: true,
    },
  });

  const invoiceApiAudits = await prisma.platformAuditLog.findMany({
    where: {
      organizationId: candidate.organization.id,
      sourceRoute: { contains: "invoices" },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, sourceRoute: true, action: true, metadata: true },
  });

  const orgAssignment = {
    candidateOrgIsNew:
      candidate.organization.createdAt.getTime() >= candidate.createdAt.getTime() - 60_000,
    candidateOrgId: candidate.organization.id,
    shayOrgId,
    sameOrganizationAsShay: shayOrgId ? candidate.organization.id === shayOrgId : null,
    membershipInShayOrg: shayOrgId
      ? memberships.some((m) => m.organizationId === shayOrgId)
      : null,
    ownerMembershipOnCandidateOrg: memberships.some(
      (m) => m.organizationId === candidate.organization.id && m.role === "owner",
    ),
    organizationOwnerUserId: (
      await prisma.organization.findUnique({
        where: { id: candidate.organization.id },
        select: { userId: true, createdAt: true, name: true },
      })
    )?.userId,
  };

  const endpointInference = {
    likelyEndpoint: "GET /api/invoices",
    filtersByOrganizationIdInCode: true,
    rowsPhysicallyUnderCandidateOrg: financialRows.length,
    rowsSharingGmailIdWithShayOrg: overlapWithShayGmailIds.length,
    crossOrgGmailIdClusterCount: new Set(crossOrg.map((row) => row.gmailMessageId)).size,
    jwtTokenLogsAvailable: false,
    authAuditInference:
      authAudits.length > 0
        ? "Audit shows login/register against candidate.organizationId only; JWT payload not persisted in audit metadata."
        : "No auth audit rows found for candidate.",
  };

  let conclusion = "F";
  if (orgAssignment.sameOrganizationAsShay) {
    conclusion = "A";
  } else if (overlapWithShayGmailIds.length > 0 || crossOrg.some((row) => row.organizationId !== candidate.organization.id)) {
    conclusion = "B";
  } else if (financialRows.length === 0) {
    conclusion = "F";
  } else if (orgAssignment.candidateOrgIsNew && !orgAssignment.membershipInShayOrg) {
    conclusion = "F";
  }

  const output = {
    shay: shayUser
      ? {
          userId: shayUser.id,
          email: maskEmail(shayUser.email),
          organizationId: shayUser.organization?.id ?? null,
        }
      : null,
    candidateUser: {
      userId: candidate.id,
      email: maskEmail(candidate.email),
      createdAt: candidate.createdAt.toISOString(),
      organizationId: candidate.organization.id,
      organizationName: truncate(candidate.organization.name, 40),
      organizationCreatedAt: candidate.organization.createdAt.toISOString(),
      memberships: memberships.map((m) => ({
        membershipId: m.id,
        organizationId: m.organizationId,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
    },
    financialRowsVisibleToCandidateOrg: financialRows.slice(0, 25).map((row) => ({
      kind: row.kind,
      id: row.id,
      organizationId: row.organizationId,
      gmailMessageId: row.gmailMessageId,
      supplierMasked: row.supplierMasked,
      amount: row.amount,
      createdAt: row.createdAt.toISOString(),
      source: row.source,
    })),
    crossOrgByGmailMessageId: crossOrg,
    orgAssignment,
    authAudits: authAudits.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      sourceRoute: row.sourceRoute,
      organizationId: row.organizationId,
      metadata: row.metadata,
    })),
    invoiceRelatedAudits: invoiceApiAudits,
    endpointInference,
    conclusion,
    conclusionLegend: {
      A: "Wrong org assignment at registration",
      B: "Cross-org Gmail ingestion duplication under new org",
      C: "Stale/wrong JWT organizationId",
      D: "Frontend cache only",
      E: "Combination",
      F: "Insufficient evidence",
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
