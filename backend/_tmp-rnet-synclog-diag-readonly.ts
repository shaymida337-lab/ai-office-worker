/**
 * READ-ONLY: SyncLog + fingerprint upsert hypothesis for Rnet/Bezeq.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { google } from "googleapis";
import { decryptIntegrationTokens } from "./src/lib/integrationSecrets.ts";
import { isInvoiceCandidate } from "./src/services/classification/invoiceCandidateGate.ts";
import { shouldRejectPersonalEmailWithoutDocumentEvidence } from "./src/services/gmailDriveLinkEvidence.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const RNET = "19f9e3d9101ed94d";
const BEZEQ = "19f9e3d4a3621e8d";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
const renderKey = process.env.RENDER_API_KEY?.trim();

async function loadRenderEnv(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${renderKey}`, Accept: "application/json" },
    });
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

async function main() {
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const syncLogs = await prisma.syncLog.findMany({
      where: {
        organizationId: ORG,
        type: "gmail_scan",
        startedAt: { gte: new Date("2026-07-26T11:00:00Z") },
      },
      orderBy: { startedAt: "asc" },
      take: 30,
    });

    const emails = await prisma.emailMessage.findMany({
      where: { organizationId: ORG, gmailId: { in: [RNET, BEZEQ] } },
    });
    const emailIds = emails.map((e) => e.id);

    // Any FDR/GSI touched around processing window regardless of gmailMessageId
    const windowStart = new Date("2026-07-26T11:47:00Z");
    const windowEnd = new Date("2026-07-26T11:50:00Z");
    const fdrTouched = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        OR: [
          { createdAt: { gte: windowStart, lte: windowEnd } },
          { updatedAt: { gte: windowStart, lte: windowEnd } },
          { emailMessageId: { in: emailIds } },
          { gmailMessageId: { in: [RNET, BEZEQ] } },
        ],
      },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        supplierName: true,
        invoiceNumber: true,
        fileName: true,
        documentFingerprint: true,
        reviewStatus: true,
        uncertaintyReason: true,
        documentType: true,
        totalAmount: true,
        documentDate: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 50,
    });
    const gsiTouched = await prisma.gmailScanItem.findMany({
      where: {
        organizationId: ORG,
        OR: [
          { createdAt: { gte: windowStart, lte: windowEnd } },
          { updatedAt: { gte: windowStart, lte: windowEnd } },
          { emailMessageId: { in: emailIds } },
          { gmailMessageId: { in: [RNET, BEZEQ] } },
        ],
      },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        supplierName: true,
        attachmentFilename: true,
        duplicateKey: true,
        reviewStatus: true,
        decisionReason: true,
        documentType: true,
        amount: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 50,
    });

    // Old Rnet FDR - check if updated during window
    const oldRnet = await prisma.financialDocumentReview.findUnique({
      where: { id: "cmqw3n5hx020dm92bp1joi8wu" },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        supplierName: true,
        invoiceNumber: true,
        fileName: true,
        documentFingerprint: true,
        reviewStatus: true,
        uncertaintyReason: true,
        totalAmount: true,
        documentDate: true,
        createdAt: true,
        updatedAt: true,
        parsedFieldsJson: true,
      },
    });

    // Simulate invoice gate + personal reject for these emails
    const gateSims = emails.map((e) => {
      const filename =
        e.gmailId === RNET ? "PHOTO-2025-09-15-14-29-36.jpg" : "PHOTO-2025-12-10-13-10-10.jpg";
      const gate = isInvoiceCandidate({
        sender: e.fromAddress,
        subject: e.subject,
        body: e.bodyText,
        attachmentFilenames: [filename],
      });
      const personalReject = shouldRejectPersonalEmailWithoutDocumentEvidence({
        isPersonalSender: true, // gmail.com
        hasPdfOrImageAttachment: true,
        strictPaymentEvidence: false,
        driveEvidence: { links: [], virtualAttachmentFilenames: [], hasStrictDriveInvoiceEvidence: false } as any,
      });
      return {
        gmailId: e.gmailId,
        gate,
        personalReject,
        processedAt: e.processedAt,
        createdAt: e.createdAt,
      };
    });

    // Download attachment and compute possible SCFC-like hashes used in codebase
    const renderEnv = await loadRenderEnv();
    if (renderEnv.SECRETS_ENCRYPTION_KEY) process.env.SECRETS_ENCRYPTION_KEY = renderEnv.SECRETS_ENCRYPTION_KEY;
    const raw = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    });
    const integration = decryptIntegrationTokens(raw!);
    const oauth2 = new google.auth.OAuth2(
      renderEnv.GOOGLE_CLIENT_ID,
      renderEnv.GOOGLE_CLIENT_SECRET,
      renderEnv.GOOGLE_INTEGRATION_REDIRECT_URI || "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback",
    );
    oauth2.setCredentials({ refresh_token: integration.refreshToken! });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    async function attHash(messageId: string) {
      const full = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
      const parts: any[] = [];
      const walk = (p: any) => {
        if (!p) return;
        if (p.body?.attachmentId) parts.push(p);
        for (const c of p.parts || []) walk(c);
      };
      walk(full.data.payload);
      const p = parts[0];
      if (!p) return null;
      const att = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: p.body.attachmentId,
      });
      const buf = Buffer.from((att.data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
      return {
        filename: p.filename,
        bytes: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex"),
        sha256_48: createHash("sha256").update(buf).digest("hex").slice(0, 48),
        sha1_48: createHash("sha1").update(buf).digest("hex").slice(0, 48),
      };
    }

    const rnetHash = await attHash(RNET);
    const bezeqHash = await attHash(BEZEQ);

    // Search fingerprints equal to sha256_48 style
    const fpSearch = [];
    for (const h of [rnetHash, bezeqHash]) {
      if (!h) continue;
      const hits = await prisma.financialDocumentReview.findMany({
        where: {
          organizationId: ORG,
          OR: [
            { documentFingerprint: h.sha256_48 },
            { sourceFingerprint: h.sha256_48 },
            { documentFingerprint: h.sha1_48 },
            { sourceFingerprint: h.sha1_48 },
            { documentFingerprint: { contains: h.sha256.slice(0, 16) } },
          ],
        },
        select: {
          id: true,
          gmailMessageId: true,
          documentFingerprint: true,
          sourceFingerprint: true,
          fileName: true,
          supplierName: true,
          invoiceNumber: true,
          reviewStatus: true,
          uncertaintyReason: true,
          updatedAt: true,
        },
        take: 10,
      });
      fpSearch.push({ hash: h, hits });
    }

    // Completion queue: is old Rnet visible?
    // Check reviewStatus filters - needs_review with OE_TRUST_BLOCKED
    const completionCandidates = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        OR: [
          { invoiceNumber: { contains: "OV255" } },
          { supplierName: { contains: "Rnet", mode: "insensitive" } },
          { supplierName: { contains: "ערנט" } },
          { fileName: "PHOTO-2025-09-15-14-29-36.jpg" },
        ],
      },
      select: {
        id: true,
        gmailMessageId: true,
        supplierName: true,
        invoiceNumber: true,
        reviewStatus: true,
        uncertaintyReason: true,
        totalAmount: true,
        documentDate: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 20,
    });

    const out = {
      syncLogs: syncLogs.map((s) => ({
        id: s.id,
        status: s.status,
        scanMode: s.scanMode,
        emailsProcessed: s.emailsProcessed,
        emailsSaved: (s as any).emailsSaved,
        invoicesFound: (s as any).invoicesFound,
        totalMatched: s.totalMatched,
        errorMessage: s.errorMessage ? String(s.errorMessage).slice(0, 400) : null,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        updatedAt: s.updatedAt,
      })),
      fdrTouched,
      gsiTouched,
      oldRnet,
      gateSims,
      fpSearch,
      completionCandidates,
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-synclog-diag.json"), JSON.stringify(out, null, 2));
    console.log(
      JSON.stringify(
        {
          syncLogCount: syncLogs.length,
          syncLogs: out.syncLogs,
          fdrTouched: fdrTouched.length,
          gsiTouched: gsiTouched.length,
          fdrTouchedSlim: fdrTouched.map((f) => ({
            id: f.id,
            gmail: f.gmailMessageId,
            emailMsg: f.emailMessageId,
            supplier: f.supplierName,
            inv: f.invoiceNumber,
            file: f.fileName,
            status: f.reviewStatus,
            reason: f.uncertaintyReason,
            updatedAt: f.updatedAt,
            createdAt: f.createdAt,
          })),
          gsiTouchedSlim: gsiTouched.map((g) => ({
            id: g.id,
            gmail: g.gmailMessageId,
            file: g.attachmentFilename,
            status: g.reviewStatus,
            reason: String(g.decisionReason || "").slice(0, 120),
            updatedAt: g.updatedAt,
          })),
          oldRnetUpdatedAt: oldRnet?.updatedAt,
          oldRnetGmail: oldRnet?.gmailMessageId,
          gateSims,
          fpHitCounts: fpSearch.map((x) => ({ file: x.hash?.filename, hits: x.hits.length, hitIds: x.hits.map((h) => h.id) })),
          completionCandidates: completionCandidates.map((c) => ({
            id: c.id,
            inv: c.invoiceNumber,
            supplier: c.supplierName,
            status: c.reviewStatus,
            reason: c.uncertaintyReason,
            gmail: c.gmailMessageId,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e), stack: String((e as any)?.stack || "").slice(0, 500) }));
  process.exit(1);
});
