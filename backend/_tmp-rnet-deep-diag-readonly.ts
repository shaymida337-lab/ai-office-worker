/**
 * READ-ONLY deep-dive: why Rnet/Bezeq messages weren't saved after 14:44 IL.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { createHash } from "crypto";
import { decryptIntegrationTokens } from "./src/lib/integrationSecrets.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const RNET_MSG = "19f9e3d9101ed94d";
const BEZEQ_MSG = "19f9e3d4a3621e8d";
const OLD_RNET_FDR = "cmqw3n5hx020dm92bp1joi8wu";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
const renderKey = process.env.RENDER_API_KEY?.trim();
const OUT = join(process.cwd(), "_tmp-rnet-deep-diag.json");

if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1" || !renderKey) {
  console.error(JSON.stringify({ error: "need PROD+ALLOW+RENDER" }));
  process.exit(2);
}

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

function headersOf(payload: any) {
  const out: Record<string, string> = {};
  for (const h of payload?.headers || []) if (h?.name) out[String(h.name).toLowerCase()] = String(h.value ?? "");
  return out;
}

function findAttachments(payload: any, acc: any[] = []) {
  if (!payload) return acc;
  if (payload.body?.attachmentId) {
    acc.push({
      filename: payload.filename || null,
      mimeType: payload.mimeType || null,
      size: payload.body?.size ?? null,
      attachmentId: payload.body.attachmentId,
    });
  }
  for (const p of payload.parts || []) findAttachments(p, acc);
  return acc;
}

async function main() {
  const renderEnv = await loadRenderEnv();
  if (renderEnv.SECRETS_ENCRYPTION_KEY) process.env.SECRETS_ENCRYPTION_KEY = renderEnv.SECRETS_ENCRYPTION_KEY;
  const clientId = renderEnv.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = renderEnv.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri =
    renderEnv.GOOGLE_INTEGRATION_REDIRECT_URI?.trim() ||
    renderEnv.GOOGLE_REDIRECT_URI?.trim() ||
    "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback";

  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

  try {
    const raw = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    });
    const integration = decryptIntegrationTokens(raw!);
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({
      access_token: integration.accessToken ?? undefined,
      refresh_token: integration.refreshToken!,
      expiry_date: integration.expiresAt?.getTime(),
    });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const msgDetails: any[] = [];
    for (const id of [RNET_MSG, BEZEQ_MSG]) {
      const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const h = headersOf(r.data.payload);
      const atts = findAttachments(r.data.payload);
      const downloaded: any[] = [];
      for (const a of atts.slice(0, 2)) {
        const att = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: id,
          id: a.attachmentId,
        });
        const b64 = att.data.data || "";
        const buf = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        const sha256 = createHash("sha256").update(buf).digest("hex");
        // Common fingerprint style in this codebase is often sha of bytes; also try sha1
        const sha1 = createHash("sha1").update(buf).digest("hex");
        downloaded.push({
          filename: a.filename,
          mimeType: a.mimeType,
          declaredSize: a.size,
          bytes: buf.length,
          sha256,
          sha1,
          // don't include content
        });
      }
      msgDetails.push({
        id,
        receivedAt: r.data.internalDate ? new Date(Number(r.data.internalDate)).toISOString() : null,
        receivedAtIL: r.data.internalDate
          ? new Date(Number(r.data.internalDate)).toLocaleString("en-IL", { timeZone: "Asia/Jerusalem" })
          : null,
        sender: h.from || null,
        subject: h.subject || null,
        messageIdHeader: h["message-id"] || null,
        labelIds: r.data.labelIds || [],
        snippet: (r.data.snippet || "").slice(0, 300),
        attachmentsMeta: atts.map(({ attachmentId, ...rest }) => rest),
        downloaded,
      });
    }

    const hashes = msgDetails.flatMap((m) => m.downloaded.flatMap((d: any) => [d.sha256, d.sha1, d.sha256.slice(0, 48)]));
    const filenames = msgDetails.flatMap((m) => m.downloaded.map((d: any) => d.filename).filter(Boolean));

    // Lookup by message id
    const byMsg = {
      gsi: await prisma.gmailScanItem.findMany({
        where: { organizationId: ORG, gmailMessageId: { in: [RNET_MSG, BEZEQ_MSG] } },
        select: { id: true, gmailMessageId: true, duplicateKey: true, reviewStatus: true, decisionReason: true, supplierName: true, createdAt: true },
      }),
      fdr: await prisma.financialDocumentReview.findMany({
        where: { organizationId: ORG, gmailMessageId: { in: [RNET_MSG, BEZEQ_MSG] } },
        select: { id: true, gmailMessageId: true, documentFingerprint: true, sourceFingerprint: true, reviewStatus: true, uncertaintyReason: true, supplierName: true, invoiceNumber: true, createdAt: true },
      }),
    };

    // Lookup by filename
    const byFile = {
      gsi: await prisma.gmailScanItem.findMany({
        where: { organizationId: ORG, attachmentFilename: { in: filenames } },
        select: {
          id: true,
          gmailMessageId: true,
          attachmentFilename: true,
          duplicateKey: true,
          supplierName: true,
          reviewStatus: true,
          decisionReason: true,
          documentType: true,
          amount: true,
          createdAt: true,
        },
        take: 20,
      }),
      fdr: await prisma.financialDocumentReview.findMany({
        where: { organizationId: ORG, fileName: { in: filenames } },
        select: {
          id: true,
          gmailMessageId: true,
          fileName: true,
          fileSize: true,
          documentFingerprint: true,
          sourceFingerprint: true,
          supplierName: true,
          invoiceNumber: true,
          documentType: true,
          documentDate: true,
          totalAmount: true,
          reviewStatus: true,
          uncertaintyReason: true,
          createdAt: true,
        },
        take: 20,
      }),
    };

    // Lookup fingerprints containing hash prefixes
    const oldFdr = await prisma.financialDocumentReview.findUnique({
      where: { id: OLD_RNET_FDR },
      select: {
        id: true,
        organizationId: true,
        gmailMessageId: true,
        fileName: true,
        fileSize: true,
        documentFingerprint: true,
        sourceFingerprint: true,
        supplierName: true,
        invoiceNumber: true,
        documentType: true,
        documentDate: true,
        totalAmount: true,
        reviewStatus: true,
        uncertaintyReason: true,
        createdAt: true,
        rawAnalysis: true,
      },
    });

    // Fingerprint equality vs downloaded hashes
    const fpMatches: any[] = [];
    for (const m of msgDetails) {
      for (const d of m.downloaded) {
        const fdrFp = await prisma.financialDocumentReview.findMany({
          where: {
            organizationId: ORG,
            OR: [
              { documentFingerprint: { contains: d.sha256.slice(0, 24) } },
              { sourceFingerprint: { contains: d.sha256.slice(0, 24) } },
              { documentFingerprint: { contains: d.sha1.slice(0, 24) } },
              { sourceFingerprint: { contains: d.sha1.slice(0, 24) } },
              { documentFingerprint: d.sha256 },
              { documentFingerprint: d.sha1 },
              { sourceFingerprint: d.sha256 },
              { sourceFingerprint: d.sha1 },
            ],
          },
          select: {
            id: true,
            gmailMessageId: true,
            documentFingerprint: true,
            sourceFingerprint: true,
            fileName: true,
            reviewStatus: true,
            uncertaintyReason: true,
            supplierName: true,
            invoiceNumber: true,
            createdAt: true,
          },
          take: 10,
        });
        const gsiFp = await prisma.gmailScanItem.findMany({
          where: {
            organizationId: ORG,
            OR: [
              { duplicateKey: { contains: d.sha256.slice(0, 24) } },
              { duplicateKey: { contains: d.sha1.slice(0, 24) } },
              { duplicateKey: d.sha256 },
              { duplicateKey: d.sha1 },
            ],
          },
          select: {
            id: true,
            gmailMessageId: true,
            duplicateKey: true,
            attachmentFilename: true,
            reviewStatus: true,
            decisionReason: true,
            supplierName: true,
            createdAt: true,
          },
          take: 10,
        });
        fpMatches.push({
          messageId: m.id,
          filename: d.filename,
          bytes: d.bytes,
          sha256: d.sha256,
          sha1: d.sha1,
          fdrFp,
          gsiFp,
          exactOldFdrDocFp:
            oldFdr &&
            (oldFdr.documentFingerprint === d.sha256 ||
              oldFdr.documentFingerprint === d.sha1 ||
              oldFdr.sourceFingerprint === d.sha256 ||
              oldFdr.sourceFingerprint === d.sha1 ||
              (oldFdr.documentFingerprint || "").includes(d.sha256.slice(0, 16)) ||
              (oldFdr.sourceFingerprint || "").includes(d.sha256.slice(0, 16))),
          oldFdrFingerprints: oldFdr
            ? { documentFingerprint: oldFdr.documentFingerprint, sourceFingerprint: oldFdr.sourceFingerprint, fileSize: oldFdr.fileSize }
            : null,
        });
      }
    }

    // Scan logs around message time (11:44 UTC)
    const scanAround = await prisma.scanLog.findMany({
      where: {
        orgId: ORG,
        startedAt: { gte: new Date("2026-07-26T11:00:00.000Z") },
      },
      orderBy: { startedAt: "asc" },
      take: 40,
    });

    // Any ScanJob / processed markers? Check models if exist
    const processedAny = await prisma.gmailScanItem.count({
      where: { organizationId: ORG, gmailMessageId: { in: [RNET_MSG, BEZEQ_MSG] } },
    });

    // Completion list presence of OLD rnet FDR
    const oldInNeedsReview = oldFdr
      ? await prisma.financialDocumentReview.findFirst({
          where: { id: OLD_RNET_FDR, organizationId: ORG },
          select: { id: true, reviewStatus: true, uncertaintyReason: true, documentDate: true, totalAmount: true, supplierName: true, invoiceNumber: true },
        })
      : null;

    // OCR text from old FDR if present
    let oldOcrPreview = null;
    if (oldFdr?.rawAnalysis) {
      const s = JSON.stringify(oldFdr.rawAnalysis);
      oldOcrPreview = {
        len: s.length,
        hasOV: s.includes("OV255006399"),
        hasRnet: /rnet/i.test(s),
        preview: s.slice(0, 600),
      };
    }

    // Manual/full scan logs today
    const allScanTypes = await prisma.scanLog.groupBy({
      by: ["type", "status"],
      where: { orgId: ORG, startedAt: { gte: new Date("2026-07-26T00:00:00.000Z") } },
      _count: true,
      _sum: { found: true, saved: true },
    });

    const manualScans = await prisma.scanLog.findMany({
      where: {
        orgId: ORG,
        startedAt: { gte: new Date("2026-07-26T00:00:00.000Z") },
        OR: [{ type: { contains: "manual" } }, { type: { contains: "full" } }, { type: { not: "quick" } }],
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    });

    const out = {
      checkedAt: new Date().toISOString(),
      messages: msgDetails,
      byMsg,
      byFile,
      fpMatches,
      oldRnetFdr: oldInNeedsReview,
      oldOcrPreview,
      processedAny,
      scanAround: scanAround.map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        found: s.found,
        saved: s.saved,
        errors: s.errors ? String(s.errors).slice(0, 400) : null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
      allScanTypesToday: allScanTypes,
      manualScans: manualScans.map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        found: s.found,
        saved: s.saved,
        errors: s.errors ? String(s.errors).slice(0, 400) : null,
        startedAt: s.startedAt,
      })),
    };
    writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(
      JSON.stringify(
        {
          wrote: OUT,
          rnetAtt: msgDetails[0]?.downloaded?.[0]?.filename,
          rnetBytes: msgDetails[0]?.downloaded?.[0]?.bytes,
          bezeqAtt: msgDetails[1]?.downloaded?.[0]?.filename,
          byMsgGsi: byMsg.gsi.length,
          byMsgFdr: byMsg.fdr.length,
          byFileGsi: byFile.gsi.length,
          byFileFdr: byFile.fdr.length,
          fpMatchCounts: fpMatches.map((x) => ({
            file: x.filename,
            fdr: x.fdrFp.length,
            gsi: x.gsiFp.length,
            exactOld: x.exactOldFdrDocFp,
          })),
          scansAfter1444: scanAround.filter((s) => new Date(s.startedAt) >= new Date("2026-07-26T11:44:00Z")).length,
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
  console.error(JSON.stringify({ error: String(e?.message ?? e), stack: String(e?.stack ?? "").slice(0, 400) }));
  process.exit(1);
});
