/**
 * READ-ONLY post-reconnect verification for kedmashopd1 org.
 * No DB writes. No commits.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { decryptIntegrationTokens } from "./src/lib/integrationSecrets.ts";
import {
  assessInvoiceCompleteness,
  INVOICE_COMPLETION_REASON,
} from "./src/services/amount/invoiceCompleteness.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const EXPECTED_MAILBOX = "kedmashopd1@gmail.com";
const BACKEND = "srv-d898po77f7vs73bu01v0";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
const renderKey = process.env.RENDER_API_KEY?.trim();

if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1" || !renderKey) {
  console.error(JSON.stringify({ error: "need PROD + ALLOW + RENDER_API_KEY" }));
  process.exit(2);
}

async function loadRenderEnv() {
  const out = {};
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${renderKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Render env-vars ${res.status}`);
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key && typeof val === "string") out[key] = val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor || data.length < 100) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  return out;
}

function parseMeta(metadata) {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function screenForAssessment(assessment) {
  return assessment.isComplete ? "invoices (חשבוניות)" : "completion (השלמת חשבוניות)";
}

async function main() {
  const renderEnv = await loadRenderEnv();
  if (renderEnv.SECRETS_ENCRYPTION_KEY) {
    process.env.SECRETS_ENCRYPTION_KEY = renderEnv.SECRETS_ENCRYPTION_KEY;
  }
  const clientId = renderEnv.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = renderEnv.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri =
    renderEnv.GOOGLE_INTEGRATION_REDIRECT_URI?.trim() ||
    "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback";

  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

  try {
    const org = await prisma.organization.findUnique({
      where: { id: ORG },
      select: {
        id: true,
        name: true,
        businessName: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });

    const raw = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    });
    if (!raw) {
      console.log(JSON.stringify({ error: "no gmail integration", org }, null, 2));
      return;
    }
    const integration = decryptIntegrationTokens(raw);
    const meta = parseMeta(raw.metadata);

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({ refresh_token: integration.refreshToken });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const liveMailbox = (profile.data.emailAddress || "").toLowerCase();

    const since2h = new Date(Date.now() - 2 * 3600e3);
    const since30m = new Date(Date.now() - 30 * 60e3);

    const syncLogs = await prisma.syncLog.findMany({
      where: { organizationId: ORG, startedAt: { gte: since2h } },
      orderBy: { startedAt: "desc" },
      take: 15,
      select: {
        id: true,
        type: true,
        status: true,
        scanMode: true,
        emailsProcessed: true,
        emailsSaved: true,
        totalMatched: true,
        invoicesFound: true,
        errorsCount: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    const isolationErrors = syncLogs.filter((s) =>
      (s.errorMessage || "").toLowerCase().includes("already connected")
    );

    const gsi = await prisma.gmailScanItem.findMany({
      where: { organizationId: ORG, createdAt: { gte: since2h } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        gmailMessageId: true,
        subject: true,
        sender: true,
        attachmentFilename: true,
        supplierName: true,
        amount: true,
        documentType: true,
        reviewStatus: true,
        decisionReason: true,
        confidenceScore: true,
        occurredAt: true,
        createdAt: true,
      },
    });

    const fdr = await prisma.financialDocumentReview.findMany({
      where: { organizationId: ORG, createdAt: { gte: since2h } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        source: true,
        gmailMessageId: true,
        fileName: true,
        subject: true,
        sender: true,
        supplierName: true,
        totalAmount: true,
        currency: true,
        documentType: true,
        documentDate: true,
        normalizedDocumentDate: true,
        reviewStatus: true,
        uncertaintyReason: true,
        confidenceScore: true,
        createdAt: true,
        updatedAt: true,
        parsedFieldsJson: true,
      },
    });

    // Mailbox probe: last 1d attachments
    const listAtt = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:1d has:attachment -in:spam -in:trash",
      maxResults: 20,
    });
    const attIds = (listAtt.data.messages || []).map((m) => m.id).filter(Boolean);
    const mailboxMessages = [];
    for (const id of attIds) {
      const full = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      const headers = Object.fromEntries(
        (full.data.payload?.headers || [])
          .filter((h) => h?.name)
          .map((h) => [String(h.name).toLowerCase(), h.value])
      );
      const atts = [];
      const walk = (p) => {
        if (!p) return;
        if (p.filename || p.body?.attachmentId) {
          atts.push({ filename: p.filename || null, mimeType: p.mimeType || null });
        }
        for (const c of p.parts || []) walk(c);
      };
      walk(full.data.payload);
      mailboxMessages.push({
        id,
        receivedAt: full.data.internalDate
          ? new Date(Number(full.data.internalDate)).toISOString()
          : null,
        sender: headers.from || null,
        to: headers.to || null,
        subject: headers.subject || null,
        attachments: atts.map((a) => a.filename).filter(Boolean),
      });
    }

    // Route each FDR via completeness
    const routed = fdr.map((item) => {
      const amount = item.totalAmount;
      const assessment = assessInvoiceCompleteness({
        supplierName: item.supplierName,
        amount,
        amountResolved: typeof amount === "number" && Number.isFinite(amount) && amount > 0,
        currency: item.currency,
        currencyExplicit: Boolean(item.currency?.trim()),
        date: item.normalizedDocumentDate ?? item.documentDate,
        documentDateExplicit: Boolean(item.normalizedDocumentDate ?? item.documentDate),
        documentType: item.documentType,
        reviewStatus: item.reviewStatus,
        rawReviewStatus: item.reviewStatus,
        confidenceScore: item.confidenceScore,
        decisionReason: item.uncertaintyReason,
        parsedFieldsJson: item.parsedFieldsJson,
        ingestSource: item.source,
      });
      return {
        fdrId: item.id,
        gmailMessageId: item.gmailMessageId,
        fileName: item.fileName,
        subject: item.subject,
        sender: item.sender,
        supplierName: item.supplierName,
        totalAmount: item.totalAmount,
        documentType: item.documentType,
        reviewStatus: item.reviewStatus,
        uncertaintyReason: item.uncertaintyReason,
        source: item.source,
        createdAt: item.createdAt.toISOString(),
        isComplete: assessment.isComplete,
        dataComplete: assessment.dataComplete,
        approvalRequired: assessment.approvalRequired,
        missingDataReasons: assessment.missingDataReasons,
        approvalReasons: assessment.approvalReasons,
        screen: screenForAssessment(assessment),
      };
    });

    const out = {
      now: new Date().toISOString(),
      org,
      gmailIntegration: {
        id: raw.id,
        connectedAt: raw.connectedAt,
        updatedAt: raw.updatedAt,
        expiresAt: raw.expiresAt,
        metadataGoogleAccountEmail: meta.googleAccountEmail ?? meta.email ?? null,
        liveMailbox,
        matchesExpected: liveMailbox === EXPECTED_MAILBOX,
        expected: EXPECTED_MAILBOX,
      },
      isolationErrorStillPresent: isolationErrors.length > 0,
      isolationErrorCount2h: isolationErrors.length,
      recentSyncLogs: syncLogs.map((s) => ({
        ...s,
        startedAt: s.startedAt?.toISOString?.() ?? s.startedAt,
        finishedAt: s.finishedAt?.toISOString?.() ?? s.finishedAt,
      })),
      mailboxHasAttachmentLast1d: {
        count: attIds.length,
        messages: mailboxMessages,
      },
      gmailScanItemsCreated2h: gsi.map((r) => ({
        ...r,
        occurredAt: r.occurredAt?.toISOString?.() ?? r.occurredAt,
        createdAt: r.createdAt.toISOString(),
      })),
      financialDocumentReviewsCreated2h: fdr.map((r) => ({
        id: r.id,
        source: r.source,
        gmailMessageId: r.gmailMessageId,
        fileName: r.fileName,
        subject: r.subject,
        sender: r.sender,
        supplierName: r.supplierName,
        totalAmount: r.totalAmount,
        documentType: r.documentType,
        reviewStatus: r.reviewStatus,
        uncertaintyReason: r.uncertaintyReason,
        createdAt: r.createdAt.toISOString(),
      })),
      routingPerDocument: routed,
      counts: {
        gsi: gsi.length,
        fdr: fdr.length,
        mailboxAttachments1d: attIds.length,
        syncLogs2h: syncLogs.length,
      },
    };

    writeFileSync(join(process.cwd(), "_tmp-kedma-post-reconnect-verify.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
