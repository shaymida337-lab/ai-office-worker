/**
 * Read-only Gmail profile verification + pre-cleanup snapshot export.
 * No DB mutations. No disconnects. No token values logged or written.
 *
 * Usage:
 *   cd backend
 *   node --import dotenv/config scripts/gmail-mailbox-verification.mjs
 *
 * Loads backend/.env for Google OAuth credentials and PROD_DATABASE_URL
 * from .env.prod.local when present.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

function loadEnvFiles() {
  loadEnv({ path: join(process.cwd(), ".env") });
  const prodLocal = join(process.cwd(), ".env.prod.local");
  if (existsSync(prodLocal)) {
    loadEnv({ path: prodLocal, override: false });
  }
}

loadEnvFiles();

const databaseUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set PROD_DATABASE_URL or DATABASE_URL");
  process.exit(1);
}

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const redirectUriCandidates = [
  process.env.GOOGLE_INTEGRATION_REDIRECT_URI?.trim(),
  process.env.GOOGLE_REDIRECT_URI?.trim(),
  "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback",
  "https://ai-office-worker-backend.onrender.com/auth/google/callback",
  "http://localhost:4000/api/integrations/gmail/callback",
  "http://localhost:4000/auth/google/callback",
].filter(Boolean);

const uniqueRedirectUris = [...new Set(redirectUriCandidates)];
const redirectUri = uniqueRedirectUris[0];

if (!clientId || !clientSecret) {
  console.error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required for profile verification");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const CONTAMINATED_ORG_IDS = [
  "cmpjd7j7e0001bl5tzv049rxb",
  "cmqve9z5j05r1kr29ivi3dyuj",
  "cmqw27e43002bm92bmf9mjy1n",
  "cmqxujfuj034ndy2czu9tjoko",
];

const CANONICAL_CANDIDATE = "cmpjd7j7e0001bl5tzv049rxb";

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
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

async function fetchGmailProfile(integration) {
  const { google } = await import("googleapis");
  let lastError = "no redirect URI succeeded";

  for (const candidateRedirect of uniqueRedirectUris) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, candidateRedirect);
    oauth2.setCredentials({ refresh_token: integration.refreshToken });

    try {
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
      const profile = await oauth2api.userinfo.get();
      return {
        ok: true,
        mailboxEmail: profile.data.email?.trim().toLowerCase() ?? null,
        googleUserId: profile.data.id ?? null,
        verifiedEmail: profile.data.verified_email ?? null,
        profileName: profile.data.name ?? null,
        evidenceSource: `google.oauth2.userinfo.get via redirect=${candidateRedirect}`,
        redirectUriUsed: candidateRedirect,
        error: null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    mailboxEmail: null,
    googleUserId: null,
    verifiedEmail: null,
    profileName: null,
    evidenceSource: "google.oauth2.userinfo.get (all redirect URIs failed)",
    redirectUriUsed: null,
    error: lastError,
  };
}

async function verifyAllIntegrations() {
  const integrations = await prisma.integration.findMany({
    where: { provider: "gmail", refreshToken: { not: null } },
    select: {
      id: true,
      organizationId: true,
      refreshToken: true,
      connectedAt: true,
      updatedAt: true,
      metadata: true,
      organization: {
        select: {
          name: true,
          businessName: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
    orderBy: { connectedAt: "asc" },
  });

  const rows = [];
  for (const integration of integrations) {
    const meta = parseMetadata(integration.metadata);
    const refreshTokenHash = hashToken(integration.refreshToken);
    const profile = await fetchGmailProfile(integration);
    rows.push({
      organizationId: integration.organizationId,
      organizationName: integration.organization.businessName || integration.organization.name,
      loginEmail: integration.organization.user.email,
      loginName: integration.organization.user.name,
      integrationId: integration.id,
      connectedAt: integration.connectedAt,
      metadataGoogleAccountEmail:
        typeof meta.googleAccountEmail === "string" ? meta.googleAccountEmail.toLowerCase() : null,
      actualConnectedGmailMailbox: profile.mailboxEmail,
      googleUserId: profile.googleUserId,
      profileName: profile.profileName,
      verifiedEmailFlag: profile.verifiedEmail,
      evidenceSource: profile.evidenceSource,
      redirectUriUsed: profile.redirectUriUsed,
      profileFetchOk: profile.ok,
      profileFetchError: profile.error,
      refreshTokenHash,
      inContaminatedCluster: CONTAMINATED_ORG_IDS.includes(integration.organizationId),
      loginMatchesMailbox:
        profile.mailboxEmail != null &&
        profile.mailboxEmail === integration.organization.user.email.trim().toLowerCase(),
      metadataMatchesLiveProfile:
        profile.mailboxEmail != null &&
        typeof meta.googleAccountEmail === "string" &&
        meta.googleAccountEmail.toLowerCase() === profile.mailboxEmail,
    });
  }

  const hashGroups = new Map();
  for (const row of rows) {
    if (!hashGroups.has(row.refreshTokenHash)) hashGroups.set(row.refreshTokenHash, []);
    hashGroups.get(row.refreshTokenHash).push(row.organizationId);
  }

  const mailboxGroups = new Map();
  for (const row of rows) {
    if (!row.actualConnectedGmailMailbox) continue;
    if (!mailboxGroups.has(row.actualConnectedGmailMailbox)) {
      mailboxGroups.set(row.actualConnectedGmailMailbox, []);
    }
    mailboxGroups.get(row.actualConnectedGmailMailbox).push(row);
  }

  return { rows, hashGroups: Object.fromEntries(hashGroups), mailboxGroups };
}

async function contaminatedIdsCte() {
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

async function exportSnapshot() {
  const cte = await contaminatedIdsCte();

  const emailMessages = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT em.*
    FROM "EmailMessage" em
    INNER JOIN contaminated_ids c ON c.gmail_id = em."gmailId"
    WHERE em."organizationId" = ANY($1::text[])
    ORDER BY em."gmailId", em."organizationId"
  `, CONTAMINATED_ORG_IDS);

  const gmailScanItems = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT gsi.*
    FROM "GmailScanItem" gsi
    INNER JOIN contaminated_ids c ON c.gmail_id = gsi."gmailMessageId"
    WHERE gsi."organizationId" = ANY($1::text[])
    ORDER BY gsi."gmailMessageId", gsi."organizationId"
  `, CONTAMINATED_ORG_IDS);

  const financialDocumentReviews = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT fdr.*
    FROM "FinancialDocumentReview" fdr
    INNER JOIN contaminated_ids c ON c.gmail_id = fdr."gmailMessageId"
    WHERE fdr."organizationId" = ANY($1::text[])
    ORDER BY fdr."gmailMessageId", fdr."organizationId"
  `, CONTAMINATED_ORG_IDS);

  const supplierPayments = await prisma.$queryRawUnsafe(`
    WITH ${cte},
    contaminated_emails AS (
      SELECT em.id, em."organizationId", em."gmailId"
      FROM "EmailMessage" em
      INNER JOIN contaminated_ids c ON c.gmail_id = em."gmailId"
    )
    SELECT sp.*
    FROM "SupplierPayment" sp
    INNER JOIN contaminated_emails ce
      ON ce.id = sp."emailMessageId" AND ce."organizationId" = sp."organizationId"
    WHERE sp."organizationId" = ANY($1::text[])
    ORDER BY ce."gmailId", sp."organizationId"
  `, CONTAMINATED_ORG_IDS);

  const invoices = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT i.*
    FROM "Invoice" i
    INNER JOIN contaminated_ids c ON c.gmail_id = i."gmailMessageId"
    WHERE i."organizationId" = ANY($1::text[])
    ORDER BY i."gmailMessageId", i."organizationId"
  `, CONTAMINATED_ORG_IDS);

  const crossLinks = await prisma.$queryRawUnsafe(`
    WITH ${cte}
    SELECT
      fdr.id AS fdr_id,
      fdr."organizationId",
      fdr."gmailMessageId",
      fdr."reviewStatus",
      fdr."documentFingerprint",
      fdr."sourceFingerprint",
      fdr."supplierPaymentId",
      fdr."emailMessageId",
      sp.id AS supplier_payment_id,
      sp."approvalStatus",
      sp.paid AS supplier_payment_paid,
      sp."emailMessageId" AS sp_email_message_id,
      sp."documentFingerprint" AS sp_document_fingerprint
    FROM "FinancialDocumentReview" fdr
    INNER JOIN contaminated_ids c ON c.gmail_id = fdr."gmailMessageId"
    LEFT JOIN "SupplierPayment" sp
      ON sp.id = fdr."supplierPaymentId" AND sp."organizationId" = fdr."organizationId"
    WHERE fdr."organizationId" = ANY($1::text[])
    ORDER BY fdr."gmailMessageId", fdr."organizationId"
  `, CONTAMINATED_ORG_IDS);

  return {
    exportedAt: new Date().toISOString(),
    clusterDefinition: "gmailMessageId in GmailScanItem with COUNT(DISTINCT organizationId) > 1",
    organizationIds: CONTAMINATED_ORG_IDS,
    counts: {
      emailMessages: emailMessages.length,
      gmailScanItems: gmailScanItems.length,
      financialDocumentReviews: financialDocumentReviews.length,
      supplierPayments: supplierPayments.length,
      invoices: invoices.length,
      crossLinks: crossLinks.length,
    },
    emailMessages,
    gmailScanItems,
    financialDocumentReviews,
    supplierPayments,
    invoices,
    crossLinks,
  };
}

function proposeCanonicalMapping(verification) {
  const { rows, hashGroups, mailboxGroups } = verification;

  const clusterRows = rows.filter((r) => r.inContaminatedCluster);
  const proposals = [];

  for (const [mailbox, orgRows] of mailboxGroups.entries()) {
    const clusterOrgs = orgRows.filter((r) => r.inContaminatedCluster);
    if (clusterOrgs.length === 0) continue;

    const sorted = [...clusterOrgs].sort(
      (a, b) => new Date(a.connectedAt).getTime() - new Date(b.connectedAt).getTime()
    );
    const recommended = sorted[0];

    proposals.push({
      mailboxEmail: mailbox,
      organizationsWithThisMailbox: orgRows.map((r) => ({
        organizationId: r.organizationId,
        organizationName: r.organizationName,
        loginEmail: r.loginEmail,
        connectedAt: r.connectedAt,
        refreshTokenHash: r.refreshTokenHash,
        inContaminatedCluster: r.inContaminatedCluster,
      })),
      contaminatedClusterOrgs: clusterOrgs.map((r) => r.organizationId),
      proposedCanonicalOrganizationId: recommended.organizationId,
      proposedCanonicalLoginEmail: recommended.loginEmail,
      proposalRule:
        clusterOrgs.length === 1
          ? "sole org with verified mailbox in cluster"
          : "earliest connectedAt among orgs sharing this verified mailbox in cluster",
      approvalStatus: "PENDING_HUMAN_APPROVAL",
      notes:
        clusterOrgs.length > 1
          ? "Multiple orgs share the same live mailbox — only one should retain contaminated rows"
          : null,
    });
  }

  const clusterMailboxes = new Set(
    clusterRows.map((r) => r.actualConnectedGmailMailbox).filter(Boolean)
  );

  const unverifiedCluster = clusterRows.filter((r) => !r.profileFetchOk);
  const mailboxMismatch = clusterRows.filter(
    (r) => r.actualConnectedGmailMailbox && !r.loginMatchesMailbox
  );

  return {
    canDesignateCanonical: unverifiedCluster.length === 0 && proposals.length > 0,
    blockedReason:
      unverifiedCluster.length > 0
        ? `${unverifiedCluster.length} contaminated-cluster integration(s) failed profile fetch`
        : proposals.length === 0
          ? "No verified mailbox mapping for contaminated cluster"
          : null,
    distinctVerifiedMailboxesInCluster: [...clusterMailboxes],
    sharedRefreshTokenHashes: Object.entries(hashGroups)
      .filter(([, orgIds]) => orgIds.length > 1)
      .map(([hash, orgIds]) => ({ refreshTokenHash: hash, organizationIds: orgIds })),
    proposals,
    prematureCandidateRejected: {
      organizationId: CANONICAL_CANDIDATE,
      reason:
        "Previously proposed as canonical before live profile verification of all cluster orgs — not approved",
    },
  };
}

function serialize(value) {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Date) return v.toISOString();
      return v;
    },
    2
  );
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "scripts", "remediation-snapshots", stamp);
  await mkdir(outDir, { recursive: true });

  console.log("=== Phase 1: Live Gmail profile verification (read-only) ===\n");
  const verification = await verifyAllIntegrations();
  const canonical = proposeCanonicalMapping(verification);

  const verificationPath = join(outDir, "mailbox-verification.json");
  await writeFile(
    verificationPath,
    serialize({
      exportedAt: new Date().toISOString(),
      verificationTable: verification.rows,
      sharedRefreshTokenHashes: canonical.sharedRefreshTokenHashes,
      canonicalMappingProposal: canonical,
    })
  );

  console.log("--- Verification table ---");
  for (const row of verification.rows) {
    console.log(
      [
        row.organizationId,
        row.organizationName,
        `login=${row.loginEmail}`,
        `mailbox=${row.actualConnectedGmailMailbox ?? "FETCH_FAILED"}`,
        `hash=${row.refreshTokenHash.slice(0, 16)}`,
        row.inContaminatedCluster ? "CLUSTER" : "",
        row.profileFetchOk ? "ok" : `ERR:${row.profileFetchError}`,
      ].join(" | ")
    );
  }

  console.log("\n=== Phase 2: Pre-cleanup snapshot export (SELECT only) ===\n");
  const snapshot = await exportSnapshot();
  const snapshotPath = join(outDir, "contaminated-rows-snapshot.json");
  await writeFile(snapshotPath, serialize(snapshot));

  const summaryPath = join(outDir, "summary.json");
  await writeFile(
    summaryPath,
    serialize({
      exportedAt: new Date().toISOString(),
      outputDirectory: outDir,
      verification: {
        totalGmailIntegrations: verification.rows.length,
        clusterIntegrations: verification.rows.filter((r) => r.inContaminatedCluster).length,
        profileFetchFailures: verification.rows.filter((r) => !r.profileFetchOk).length,
      },
      snapshotStatistics: snapshot.counts,
      canonicalMappingProposal: canonical,
      files: {
        mailboxVerification: verificationPath,
        contaminatedRowsSnapshot: snapshotPath,
        summary: summaryPath,
      },
    })
  );

  console.log("--- Snapshot statistics ---");
  console.log(serialize(snapshot.counts));
  console.log("\n--- Canonical mapping proposal (NOT APPROVED) ---");
  console.log(serialize(canonical));
  console.log(`\nFiles written to: ${outDir}`);
  console.log("No mutations performed.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
