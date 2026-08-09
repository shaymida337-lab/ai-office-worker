/**
 * READ-ONLY: diagnose missing Rnet invoice + Bezeq non-financial for kedmashopd1.
 * No DB writes. Never prints tokens/secrets.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { decryptIntegrationTokens } from "./src/lib/integrationSecrets.ts";
import { buildFastScanQueries } from "./src/services/gmailFastScanQuery.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
const renderKey = process.env.RENDER_API_KEY?.trim();
const OUT = join(process.cwd(), "_tmp-rnet-missing-diag.json");

if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1" || !renderKey) {
  console.error(JSON.stringify({ error: "need PROD + ALLOW + RENDER_API_KEY" }));
  process.exit(2);
}

async function loadRenderEnv(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
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

function headersOf(payload: any) {
  const out: Record<string, string> = {};
  for (const h of payload?.headers || []) {
    if (h?.name) out[String(h.name).toLowerCase()] = String(h.value ?? "");
  }
  return out;
}

function collectParts(payload: any, acc: any[] = []) {
  if (!payload) return acc;
  acc.push({
    mimeType: payload.mimeType ?? null,
    filename: payload.filename || null,
    size: payload.body?.size ?? null,
    attachmentId: payload.body?.attachmentId ? "present" : null,
    partId: payload.partId ?? null,
  });
  for (const p of payload.parts || []) collectParts(p, acc);
  return acc;
}

function snippet(text: unknown, n = 400) {
  if (typeof text !== "string") return null;
  return text.length <= n ? text : text.slice(0, n) + "…";
}

function pickOcr(raw: any) {
  if (!raw || typeof raw !== "object") return null;
  const ocr = raw.ocrText ?? raw.ocr ?? raw.text ?? null;
  if (typeof ocr === "string") return { kind: "string", len: ocr.length, preview: snippet(ocr, 500) };
  if (ocr && typeof ocr === "object") {
    const pdf = ocr.pdfText ?? ocr.text ?? null;
    const vision = ocr.visionText ?? ocr.ocrText ?? null;
    const combined = [pdf, vision].filter((x) => typeof x === "string").join("\n");
    return {
      kind: "object",
      keys: Object.keys(ocr).slice(0, 20),
      pdfLen: typeof pdf === "string" ? pdf.length : 0,
      visionLen: typeof vision === "string" ? vision.length : 0,
      preview: snippet(combined || JSON.stringify(ocr).slice(0, 500), 500),
      hasBezeqNegation:
        typeof combined === "string" &&
        (combined.includes("אינו מהווה חשבונית") || combined.includes("אינו מהווה חשבונית מס")),
      hasRnet: typeof combined === "string" && /rnet|OV255006399/i.test(combined),
      hasDocNo: typeof combined === "string" && combined.includes("OV255006399"),
    };
  }
  // search nested
  const asStr = JSON.stringify(raw);
  return {
    kind: "raw_json",
    len: asStr.length,
    preview: snippet(asStr, 400),
    hasBezeqNegation: asStr.includes("אינו מהווה חשבונית"),
    hasRnet: /rnet|OV255006399/i.test(asStr),
    hasDocNo: asStr.includes("OV255006399"),
  };
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
    renderEnv.GOOGLE_REDIRECT_URI?.trim() ||
    "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback";
  if (!clientId || !clientSecret) throw new Error("missing google client on render");

  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

  try {
    const raw = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    });
    if (!raw) throw new Error("no gmail integration");
    const integration = decryptIntegrationTokens(raw);
    if (!integration.refreshToken) throw new Error("no refresh token");

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({
      access_token: integration.accessToken ?? undefined,
      refresh_token: integration.refreshToken,
      expiry_date: integration.expiresAt?.getTime(),
    });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: "me" });

    // Israel afternoon window ≈ 11:44–12:15 UTC on 2026-07-26; widen to today
    const searchQueries = [
      "newer_than:1d rnet",
      "newer_than:1d Rnet",
      "newer_than:1d OV255006399",
      "newer_than:1d subject:rnet",
      'newer_than:1d "Rnet technologies"',
      "newer_than:1d בזק",
      'newer_than:1d "ניהול חשבון"',
      'newer_than:1d "אינו מהווה חשבונית"',
      "newer_than:1d has:attachment -in:spam -in:trash",
      "newer_than:6h",
      "newer_than:6h has:attachment",
      "after:2026/07/26",
      "after:2026/07/26 has:attachment",
      ...buildFastScanQueries(),
    ];

    const queryHits: any[] = [];
    const idSet = new Set<string>();
    for (const q of searchQueries) {
      try {
        const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
        const ids = (r.data.messages || []).map((m) => m.id!).filter(Boolean);
        for (const id of ids) idSet.add(id);
        queryHits.push({ query: q, count: ids.length, ids: ids.slice(0, 20) });
      } catch (e: any) {
        queryHits.push({ query: q, count: 0, ids: [], error: String(e?.message ?? e) });
      }
    }

    const messages: any[] = [];
    for (const id of [...idSet].slice(0, 80)) {
      const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const h = headersOf(r.data.payload);
      const parts = collectParts(r.data.payload);
      const attachments = parts.filter(
        (p) =>
          p.filename ||
          (p.mimeType &&
            (String(p.mimeType).startsWith("image/") ||
              String(p.mimeType).startsWith("application/") ||
              p.attachmentId)),
      );
      const subject = h.subject || "";
      const sender = h.from || "";
      const snippetText = r.data.snippet || "";
      const hay = `${subject}\n${sender}\n${snippetText}\n${attachments.map((a) => a.filename).join(" ")}`;
      messages.push({
        id,
        threadId: r.data.threadId,
        receivedAt: r.data.internalDate
          ? new Date(Number(r.data.internalDate)).toISOString()
          : null,
        receivedAtIL: r.data.internalDate
          ? new Date(Number(r.data.internalDate)).toLocaleString("en-IL", { timeZone: "Asia/Jerusalem" })
          : null,
        sender,
        to: h.to || null,
        subject,
        snippet: snippet(snippetText, 240),
        labelIds: r.data.labelIds || [],
        attachments,
        matchRnet: /rnet|OV255006399/i.test(hay),
        matchBezeq: /בזק|bezeq|ניהול חשבון|אינו מהווה/i.test(hay),
        matchDocNo: /OV255006399/i.test(hay),
      });
    }
    messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));

    const rnetMsgs = messages.filter((m) => m.matchRnet || m.matchDocNo);
    const bezeqMsgs = messages.filter((m) => m.matchBezeq);
    // Also recent afternoon window messages (Israel 14:00–16:00 = UTC 11:00–13:00)
    const afternoon = messages.filter((m) => {
      if (!m.receivedAt) return false;
      const d = new Date(m.receivedAt);
      // today-ish in last 6h
      return Date.now() - d.getTime() < 8 * 3600e3;
    });

    const candidateIds = [
      ...new Set([
        ...rnetMsgs.map((m) => m.id),
        ...bezeqMsgs.map((m) => m.id),
        ...afternoon.map((m) => m.id),
      ]),
    ];

    // DB lookups
    const since = new Date(Date.now() - 24 * 3600e3);
    const gsiRecent = await prisma.gmailScanItem.findMany({
      where: { organizationId: ORG, createdAt: { gte: since } },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        sender: true,
        subject: true,
        supplierName: true,
        amount: true,
        documentType: true,
        attachmentFilename: true,
        reviewStatus: true,
        decisionReason: true,
        duplicateKey: true,
        confidenceScore: true,
        occurredAt: true,
        normalizedDocumentDate: true,
        createdAt: true,
        rawAnalysis: true,
        parsedFieldsJson: true,
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    });

    const fdrRecent = await prisma.financialDocumentReview.findMany({
      where: { organizationId: ORG, createdAt: { gte: since } },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        source: true,
        sender: true,
        subject: true,
        fileName: true,
        fileSize: true,
        documentType: true,
        supplierName: true,
        invoiceNumber: true,
        documentDate: true,
        totalAmount: true,
        reviewStatus: true,
        uncertaintyReason: true,
        documentFingerprint: true,
        sourceFingerprint: true,
        confidenceScore: true,
        createdAt: true,
        rawAnalysis: true,
        parsedFieldsJson: true,
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    });

    const textMatch = (s: string | null | undefined) =>
      /rnet|OV255006399|בזק|bezeq|ניהול חשבון|אינו מהווה/i.test(String(s ?? ""));

    const gsiHits = gsiRecent.filter(
      (r) =>
        candidateIds.includes(r.gmailMessageId) ||
        textMatch(r.supplierName) ||
        textMatch(r.subject) ||
        textMatch(r.sender) ||
        textMatch(r.attachmentFilename) ||
        textMatch(JSON.stringify(r.rawAnalysis ?? {}).slice(0, 5000)) ||
        textMatch(JSON.stringify(r.parsedFieldsJson ?? {}).slice(0, 3000)),
    );

    const fdrHits = fdrRecent.filter(
      (r) =>
        (r.gmailMessageId && candidateIds.includes(r.gmailMessageId)) ||
        textMatch(r.supplierName) ||
        textMatch(r.subject) ||
        textMatch(r.sender) ||
        textMatch(r.fileName) ||
        textMatch(r.invoiceNumber) ||
        textMatch(r.uncertaintyReason) ||
        textMatch(JSON.stringify(r.rawAnalysis ?? {}).slice(0, 5000)) ||
        textMatch(JSON.stringify(r.parsedFieldsJson ?? {}).slice(0, 3000)),
    );

    // Broader DB search for doc number / Rnet regardless of createdAt
    const gsiByDoc = await prisma.gmailScanItem.findMany({
      where: {
        organizationId: ORG,
        OR: [
          { subject: { contains: "Rnet", mode: "insensitive" } },
          { subject: { contains: "OV255006399", mode: "insensitive" } },
          { supplierName: { contains: "Rnet", mode: "insensitive" } },
          { supplierName: { contains: "OV255", mode: "insensitive" } },
          { attachmentFilename: { contains: "OV255", mode: "insensitive" } },
          { sender: { contains: "rnet", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        gmailMessageId: true,
        supplierName: true,
        subject: true,
        amount: true,
        documentType: true,
        reviewStatus: true,
        decisionReason: true,
        createdAt: true,
        attachmentFilename: true,
      },
      take: 20,
    });

    const fdrByDoc = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        OR: [
          { subject: { contains: "Rnet", mode: "insensitive" } },
          { supplierName: { contains: "Rnet", mode: "insensitive" } },
          { invoiceNumber: { contains: "OV255", mode: "insensitive" } },
          { fileName: { contains: "OV255", mode: "insensitive" } },
          { sender: { contains: "rnet", mode: "insensitive" } },
          { uncertaintyReason: { contains: "Rnet", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        gmailMessageId: true,
        supplierName: true,
        invoiceNumber: true,
        subject: true,
        documentType: true,
        reviewStatus: true,
        uncertaintyReason: true,
        totalAmount: true,
        documentDate: true,
        createdAt: true,
        fileName: true,
      },
      take: 20,
    });

    const bezeqGsi = gsiRecent.filter(
      (r) =>
        /בזק|bezeq|ניהול חשבון/i.test(
          `${r.supplierName}\n${r.subject}\n${r.sender}\n${r.decisionReason}\n${JSON.stringify(r.rawAnalysis ?? {}).slice(0, 8000)}`,
        ),
    );
    const bezeqFdr = fdrRecent.filter(
      (r) =>
        /בזק|bezeq|ניהול חשבון|אינו מהווה/i.test(
          `${r.supplierName}\n${r.subject}\n${r.sender}\n${r.uncertaintyReason}\n${r.documentType}\n${JSON.stringify(r.rawAnalysis ?? {}).slice(0, 8000)}`,
        ),
    );

    const scanLogs = await prisma.scanLog.findMany({
      where: { orgId: ORG, startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: 30,
    });

    // Per-message DB presence for Rnet candidates
    const rnetPipeline = [];
    for (const m of rnetMsgs.length ? rnetMsgs : afternoon.slice(0, 15)) {
      const gsi = gsiRecent.filter((g) => g.gmailMessageId === m.id);
      const fdr = fdrRecent.filter((f) => f.gmailMessageId === m.id);
      rnetPipeline.push({
        gmail: {
          id: m.id,
          receivedAt: m.receivedAt,
          receivedAtIL: m.receivedAtIL,
          sender: m.sender,
          subject: m.subject,
          snippet: m.snippet,
          labels: m.labelIds,
          attachments: m.attachments,
          matchRnet: m.matchRnet,
          matchDocNo: m.matchDocNo,
          matchBezeq: m.matchBezeq,
        },
        gsiCount: gsi.length,
        fdrCount: fdr.length,
        gsi: gsi.map((g) => ({
          id: g.id,
          supplierName: g.supplierName,
          amount: g.amount,
          documentType: g.documentType,
          reviewStatus: g.reviewStatus,
          decisionReason: snippet(g.decisionReason, 300),
          attachmentFilename: g.attachmentFilename,
          duplicateKey: g.duplicateKey,
          confidenceScore: g.confidenceScore,
          normalizedDocumentDate: g.normalizedDocumentDate,
          occurredAt: g.occurredAt,
          createdAt: g.createdAt,
          ocr: pickOcr(g.rawAnalysis),
          parsedPreview: snippet(JSON.stringify(g.parsedFieldsJson ?? null), 400),
        })),
        fdr: fdr.map((f) => ({
          id: f.id,
          supplierName: f.supplierName,
          invoiceNumber: f.invoiceNumber,
          totalAmount: f.totalAmount,
          documentType: f.documentType,
          documentDate: f.documentDate,
          reviewStatus: f.reviewStatus,
          uncertaintyReason: f.uncertaintyReason,
          fileName: f.fileName,
          fileSize: f.fileSize,
          confidenceScore: f.confidenceScore,
          createdAt: f.createdAt,
          ocr: pickOcr(f.rawAnalysis),
          parsedPreview: snippet(JSON.stringify(f.parsedFieldsJson ?? null), 400),
        })),
      });
    }

    // If no rnetMsgs matched by text, still check afternoon msgs without GSI
    const afternoonMissing = afternoon
      .filter((m) => !gsiRecent.some((g) => g.gmailMessageId === m.id))
      .map((m) => ({
        id: m.id,
        receivedAtIL: m.receivedAtIL,
        sender: m.sender,
        subject: m.subject,
        snippet: m.snippet,
        attachments: m.attachments,
        matchRnet: m.matchRnet,
        matchBezeq: m.matchBezeq,
      }));

    // Which fast queries would return Rnet message ids
    const rnetIds = new Set(rnetMsgs.map((m) => m.id));
    const fastCoverage = queryHits
      .filter((q) => buildFastScanQueries().includes(q.query) || q.query.includes("has:attachment"))
      .map((q) => ({
        query: q.query,
        hitCount: q.count,
        hitsRnet: (q.ids || []).filter((id: string) => rnetIds.has(id)),
      }));

    const out = {
      checkedAt: new Date().toISOString(),
      org: ORG,
      mailbox: profile.data.emailAddress ?? null,
      gmailMessagePool: messages.length,
      queryHits: queryHits.map((q) => ({
        query: q.query,
        count: q.count,
        error: q.error ?? null,
        sampleIds: (q.ids || []).slice(0, 5),
      })),
      rnetMessages: rnetMsgs,
      bezeqMessages: bezeqMsgs,
      afternoonRecent: afternoon.slice(0, 25).map((m) => ({
        id: m.id,
        receivedAtIL: m.receivedAtIL,
        sender: m.sender,
        subject: m.subject,
        attCount: (m.attachments || []).length,
        matchRnet: m.matchRnet,
        matchBezeq: m.matchBezeq,
        hasGsi: gsiRecent.some((g) => g.gmailMessageId === m.id),
        hasFdr: fdrRecent.some((f) => f.gmailMessageId === m.id),
      })),
      afternoonMissingFromDb: afternoonMissing,
      rnetPipeline,
      gsiHitsSlim: gsiHits.map((g) => ({
        id: g.id,
        gmailMessageId: g.gmailMessageId,
        supplierName: g.supplierName,
        subject: g.subject,
        amount: g.amount,
        documentType: g.documentType,
        reviewStatus: g.reviewStatus,
        decisionReason: snippet(g.decisionReason, 200),
        attachmentFilename: g.attachmentFilename,
        createdAt: g.createdAt,
        ocr: pickOcr(g.rawAnalysis),
      })),
      fdrHitsSlim: fdrHits.map((f) => ({
        id: f.id,
        gmailMessageId: f.gmailMessageId,
        supplierName: f.supplierName,
        invoiceNumber: f.invoiceNumber,
        documentType: f.documentType,
        reviewStatus: f.reviewStatus,
        uncertaintyReason: f.uncertaintyReason,
        totalAmount: f.totalAmount,
        documentDate: f.documentDate,
        fileName: f.fileName,
        createdAt: f.createdAt,
        ocr: pickOcr(f.rawAnalysis),
      })),
      gsiByDoc,
      fdrByDoc,
      bezeqGsi: bezeqGsi.map((g) => ({
        id: g.id,
        gmailMessageId: g.gmailMessageId,
        supplierName: g.supplierName,
        documentType: g.documentType,
        reviewStatus: g.reviewStatus,
        decisionReason: snippet(g.decisionReason, 300),
        ocr: pickOcr(g.rawAnalysis),
      })),
      bezeqFdr: bezeqFdr.map((f) => ({
        id: f.id,
        gmailMessageId: f.gmailMessageId,
        supplierName: f.supplierName,
        documentType: f.documentType,
        reviewStatus: f.reviewStatus,
        uncertaintyReason: f.uncertaintyReason,
        ocr: pickOcr(f.rawAnalysis),
      })),
      scanLogs: scanLogs.map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        found: s.found,
        saved: s.saved,
        errors: snippet(s.errors, 500),
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
      fastCoverage,
      counts: {
        gsiRecent: gsiRecent.length,
        fdrRecent: fdrRecent.length,
        rnetMsg: rnetMsgs.length,
        bezeqMsg: bezeqMsgs.length,
      },
    };

    writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
    console.log(
      JSON.stringify(
        {
          wrote: OUT,
          mailbox: out.mailbox,
          rnetMsg: rnetMsgs.length,
          bezeqMsg: bezeqMsgs.length,
          afternoon: afternoon.length,
          afternoonMissing: afternoonMissing.length,
          gsiByDoc: gsiByDoc.length,
          fdrByDoc: fdrByDoc.length,
          scanLogs: scanLogs.length,
          rnetPipeline: rnetPipeline.length,
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
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
