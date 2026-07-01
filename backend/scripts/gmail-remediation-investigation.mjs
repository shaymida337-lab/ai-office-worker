/**
 * SELECT-only remediation investigation. No mutations.
 * Usage: DOTENV_CONFIG_PATH=.env.prod.local node --import dotenv/config scripts/gmail-remediation-investigation.mjs
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set PROD_DATABASE_URL or DATABASE_URL");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function jsonPrint(value) {
  console.log(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v), 2));
}

function parseMetadata(metadata) {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const CONTAMINATED_ORG_IDS = [
  "cmpjd7j7e0001bl5tzv049rxb",
  "cmqve9z5j05r1kr29ivi3dyuj",
  "cmqw27e43002bm92bmf9mjy1n",
  "cmqxujfuj034ndy2czu9tjoko",
];

async function orgProfiles() {
  const orgs = await prisma.organization.findMany({
    where: { id: { in: CONTAMINATED_ORG_IDS } },
    select: {
      id: true,
      name: true,
      businessName: true,
      user: { select: { email: true, name: true } },
      integrations: {
        where: { provider: "gmail" },
        select: { id: true, connectedAt: true, updatedAt: true, metadata: true, refreshToken: true },
      },
    },
  });

  return orgs.map((org) => {
    const gmail = org.integrations[0] ?? null;
    const meta = parseMetadata(gmail?.metadata ?? null);
    return {
      organizationId: org.id,
      organizationName: org.businessName || org.name,
      loginEmail: org.user.email,
      loginName: org.user.name,
      gmailConnected: Boolean(gmail?.refreshToken),
      gmailConnectedAt: gmail?.connectedAt ?? null,
      gmailMetadataEmail: typeof meta.googleAccountEmail === "string" ? meta.googleAccountEmail : null,
      evidenceSource: meta.googleAccountEmail
        ? "integration.metadata.googleAccountEmail"
        : gmail?.refreshToken
          ? "integration exists; mailbox email not yet in metadata (fetch via OAuth profile in Phase 2)"
          : "no gmail integration",
    };
  });
}

async function contaminatedGmailIdsCte() {
  return `
    contaminated_ids AS (
      SELECT "gmailMessageId" AS gmail_id
      FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    )
  `;
}

async function tableContamination() {
  const cte = await contaminatedGmailIdsCte();
  const tables = [
    { table: "GmailScanItem", idCol: "gmailMessageId" },
    { table: "FinancialDocumentReview", idCol: "gmailMessageId" },
    { table: "EmailMessage", idCol: "gmailId" },
    { table: "Invoice", idCol: "gmailMessageId" },
  ];

  const results = {};
  for (const { table, idCol } of tables) {
    const perOrg = await prisma.$queryRawUnsafe(`
      WITH ${cte}
      SELECT t."organizationId", COUNT(*)::int AS row_count, COUNT(DISTINCT t."${idCol}")::int AS gmail_id_count
      FROM "${table}" t
      INNER JOIN contaminated_ids c ON c.gmail_id = t."${idCol}"
      WHERE t."organizationId" = ANY($1::text[])
      GROUP BY t."organizationId"
      ORDER BY row_count DESC
    `, CONTAMINATED_ORG_IDS);

    const totals = await prisma.$queryRawUnsafe(`
      WITH ${cte}
      SELECT COUNT(*)::int AS row_count, COUNT(DISTINCT t."${idCol}")::int AS gmail_id_count
      FROM "${table}" t
      INNER JOIN contaminated_ids c ON c.gmail_id = t."${idCol}"
      WHERE t."organizationId" = ANY($1::text[])
    `, CONTAMINATED_ORG_IDS);

    results[table] = { totals: totals[0] ?? {}, perOrg };
  }

  // SupplierPayment via emailMessageId join
  const sp = await prisma.$queryRawUnsafe(`
    WITH ${cte},
    contaminated_emails AS (
      SELECT em.id, em."organizationId", em."gmailId"
      FROM "EmailMessage" em
      INNER JOIN contaminated_ids c ON c.gmail_id = em."gmailId"
    )
    SELECT sp."organizationId", COUNT(*)::int AS row_count, COUNT(DISTINCT ce."gmailId")::int AS gmail_id_count
    FROM "SupplierPayment" sp
    INNER JOIN contaminated_emails ce ON ce.id = sp."emailMessageId" AND ce."organizationId" = sp."organizationId"
    WHERE sp."organizationId" = ANY($1::text[])
    GROUP BY sp."organizationId"
    ORDER BY row_count DESC
  `, CONTAMINATED_ORG_IDS);

  const spTotals = await prisma.$queryRawUnsafe(`
    WITH ${cte},
    contaminated_emails AS (
      SELECT em.id, em."organizationId", em."gmailId"
      FROM "EmailMessage" em
      INNER JOIN contaminated_ids c ON c.gmail_id = em."gmailId"
    )
    SELECT COUNT(*)::int AS row_count, COUNT(DISTINCT ce."gmailId")::int AS gmail_id_count
    FROM "SupplierPayment" sp
    INNER JOIN contaminated_emails ce ON ce.id = sp."emailMessageId" AND ce."organizationId" = sp."organizationId"
    WHERE sp."organizationId" = ANY($1::text[])
  `, CONTAMINATED_ORG_IDS);

  results.SupplierPayment = { totals: spTotals[0] ?? {}, perOrg: sp };

  // FDR with supplierPaymentId
  const fdrApproved = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT
      t."organizationId",
      t."reviewStatus",
      COUNT(*)::int AS row_count
    FROM "FinancialDocumentReview" t
    INNER JOIN contaminated_ids c ON c.gmail_id = t."gmailMessageId"
    WHERE t."organizationId" = ANY($1::text[])
    GROUP BY t."organizationId", t."reviewStatus"
    ORDER BY t."organizationId", row_count DESC
  `, CONTAMINATED_ORG_IDS);

  results.FDR_by_reviewStatus = fdrApproved;

  const spApproved = await prisma.$queryRawUnsafe(`
    WITH ${cte},
    contaminated_emails AS (
      SELECT em.id, em."organizationId", em."gmailId"
      FROM "EmailMessage" em
      INNER JOIN contaminated_ids c ON c.gmail_id = em."gmailId"
    )
    SELECT sp."organizationId", sp."approvalStatus", sp.paid, COUNT(*)::int AS row_count
    FROM "SupplierPayment" sp
    INNER JOIN contaminated_emails ce ON ce.id = sp."emailMessageId" AND ce."organizationId" = sp."organizationId"
    WHERE sp."organizationId" = ANY($1::text[])
    GROUP BY sp."organizationId", sp."approvalStatus", sp.paid
    ORDER BY sp."organizationId", row_count DESC
  `, CONTAMINATED_ORG_IDS);

  results.SupplierPayment_by_approval = spApproved;

  return results;
}

async function senderEvidence() {
  return prisma.$queryRawUnsafe(`
    WITH contaminated_ids AS (
      SELECT "gmailMessageId" AS gmail_id
      FROM "GmailScanItem"
      WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId" <> ''
      GROUP BY "gmailMessageId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    )
    SELECT
      gsi."organizationId",
      COUNT(DISTINCT gsi."gmailMessageId")::int AS contaminated_message_count,
      COUNT(DISTINCT gsi."senderEmail")::int AS distinct_sender_emails,
      MODE() WITHIN GROUP (ORDER BY LOWER(COALESCE(gsi."senderEmail", ''))) AS mode_sender_email
    FROM "GmailScanItem" gsi
    INNER JOIN contaminated_ids c ON c.gmail_id = gsi."gmailMessageId"
    WHERE gsi."organizationId" = ANY($1::text[])
    GROUP BY gsi."organizationId"
  `, CONTAMINATED_ORG_IDS);
}

async function emailFromAddressTop() {
  return prisma.$queryRawUnsafe(`
    WITH contaminated_ids AS (
      SELECT "gmailId" AS gmail_id
      FROM "EmailMessage"
      WHERE "gmailId" IS NOT NULL AND "gmailId" <> ''
      GROUP BY "gmailId"
      HAVING COUNT(DISTINCT "organizationId") > 1
    )
    SELECT
      em."organizationId",
      LOWER(SPLIT_PART(REGEXP_REPLACE(em."fromAddress", '.*<([^>]+)>.*', '\\1'), '@', 1)) AS from_local,
      LOWER(REGEXP_REPLACE(em."fromAddress", '.*<([^>]+)>.*', '\\1')) AS from_email_extracted,
      COUNT(*)::int AS row_count
    FROM "EmailMessage" em
    INNER JOIN contaminated_ids c ON c.gmail_id = em."gmailId"
    WHERE em."organizationId" = ANY($1::text[])
    GROUP BY em."organizationId", from_local, from_email_extracted
    ORDER BY em."organizationId", row_count DESC
    LIMIT 40
  `, CONTAMINATED_ORG_IDS);
}

async function driveLinksAffected() {
  const cte = await contaminatedGmailIdsCte();
  const gsi = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT
      t."organizationId",
      COUNT(*) FILTER (WHERE t."driveFileLink" IS NOT NULL AND t."driveFileLink" <> '')::int AS with_drive_link,
      COUNT(*)::int AS total
    FROM "GmailScanItem" t
    INNER JOIN contaminated_ids c ON c.gmail_id = t."gmailMessageId"
    WHERE t."organizationId" = ANY($1::text[])
    GROUP BY t."organizationId"
  `, CONTAMINATED_ORG_IDS);

  const fdr = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT
      t."organizationId",
      COUNT(*) FILTER (WHERE t."driveFileUrl" IS NOT NULL AND t."driveFileUrl" <> '')::int AS with_drive_url,
      COUNT(*)::int AS total
    FROM "FinancialDocumentReview" t
    INNER JOIN contaminated_ids c ON c.gmail_id = t."gmailMessageId"
    WHERE t."organizationId" = ANY($1::text[])
    GROUP BY t."organizationId"
  `, CONTAMINATED_ORG_IDS);

  return { GmailScanItem_drive: gsi, FDR_drive: fdr };
}

async function crossOrgFingerprintCollisions() {
  return prisma.$queryRawUnsafe(`
    WITH contaminated_fdr AS (
      SELECT f.*
      FROM "FinancialDocumentReview" f
      WHERE f."gmailMessageId" IN (
        SELECT "gmailMessageId" FROM "GmailScanItem"
        GROUP BY "gmailMessageId" HAVING COUNT(DISTINCT "organizationId") > 1
      )
    )
    SELECT
      a."documentFingerprint",
      a."gmailMessageId",
      array_agg(DISTINCT a."organizationId" ORDER BY a."organizationId") AS org_ids,
      COUNT(*)::int AS fdr_rows
    FROM contaminated_fdr a
    GROUP BY a."documentFingerprint", a."gmailMessageId"
    HAVING COUNT(DISTINCT a."organizationId") > 1
    ORDER BY fdr_rows DESC
    LIMIT 15
  `);
}

async function allGmailIntegrations() {
  const integrations = await prisma.integration.findMany({
    where: { provider: "gmail", refreshToken: { not: null } },
    select: {
      organizationId: true,
      connectedAt: true,
      metadata: true,
      refreshToken: true,
      organization: {
        select: { name: true, businessName: true, user: { select: { email: true } } },
      },
    },
    orderBy: { connectedAt: "asc" },
  });

  const byHash = new Map();
  for (const row of integrations) {
    const hash = createHash("sha256").update(row.refreshToken ?? "", "utf8").digest("hex").slice(0, 16);
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(row);
  }

  return {
    allIntegrations: integrations.map((row) => {
      const meta = parseMetadata(row.metadata);
      return {
        organizationId: row.organizationId,
        orgName: row.organization.businessName || row.organization.name,
        loginEmail: row.organization.user.email,
        googleAccountEmail: typeof meta.googleAccountEmail === "string" ? meta.googleAccountEmail : null,
        connectedAt: row.connectedAt,
      };
    }),
    sharedTokenGroups: [...byHash.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([hash, rows]) => ({
        tokenHashPrefix: hash,
        organizations: rows.map((r) => ({
          organizationId: r.organizationId,
          loginEmail: r.organization.user.email,
        })),
      })),
  };
}

async function main() {
  console.log("=== Gmail remediation investigation (SELECT only) ===\n");

  console.log("--- 1. Affected organization profiles ---");
  jsonPrint(await orgProfiles());

  console.log("\n--- 2. All Gmail integrations (mailbox assignment evidence) ---");
  jsonPrint(await allGmailIntegrations());

  console.log("\n--- 3. Contamination by table (4-org cluster) ---");
  jsonPrint(await tableContamination());

  console.log("\n--- 4. Sender/from evidence on contaminated rows ---");
  jsonPrint(await senderEvidence());
  jsonPrint(await emailFromAddressTop());

  console.log("\n--- 5. Drive links on contaminated rows ---");
  jsonPrint(await driveLinksAffected());

  console.log("\n--- 6. Cross-org documentFingerprint collisions (sample) ---");
  jsonPrint(await crossOrgFingerprintCollisions());

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
