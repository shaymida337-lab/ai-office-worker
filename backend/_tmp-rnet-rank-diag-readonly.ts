/**
 * READ-ONLY: why Rnet FDR missing from completion where + Bezeq live attachment OCR cue.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { decryptIntegrationTokens } from "./src/lib/integrationSecrets.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const RNET_FDR = "cmqw3n5hx020dm92bp1joi8wu";
const BEZEQ_FDR = "cmqw3onmp0227m92bemcb1bkm";
const BEZEQ_MSG = "19f9e3d4a3621e8d";
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
    // Same-ish where as completion review candidates (needs_review)
    const whereNeeds = {
      organizationId: ORG,
      reviewStatus: "needs_review",
    } as const;

    const countNeeds = await prisma.financialDocumentReview.count({ where: whereNeeds });
    const rnetInNeeds = await prisma.financialDocumentReview.findFirst({
      where: { ...whereNeeds, id: RNET_FDR },
      select: { id: true, reviewStatus: true, documentDate: true, createdAt: true, uncertaintyReason: true },
    });
    const bezeqInNeeds = await prisma.financialDocumentReview.findFirst({
      where: { ...whereNeeds, id: BEZEQ_FDR },
      select: { id: true, reviewStatus: true, documentDate: true, createdAt: true, uncertaintyReason: true },
    });

    // Order like completion: documentDate desc — where do these rank?
    const topFdr = await prisma.financialDocumentReview.findMany({
      where: whereNeeds,
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 40,
      select: { id: true, supplierName: true, documentDate: true, totalAmount: true, createdAt: true, fileName: true },
    });
    const rnetRank = topFdr.findIndex((r) => r.id === RNET_FDR);
    const bezeqRank = topFdr.findIndex((r) => r.id === BEZEQ_FDR);

    // payments with same invoice numbers
    const payments = await prisma.supplierPayment.findMany({
      where: {
        organizationId: ORG,
        OR: [
          { invoiceNumber: { contains: "OV255" } },
          { supplier: { contains: "ערנט" } },
          { supplier: { contains: "Rnet", mode: "insensitive" } },
          { amount: 354 },
        ],
      },
      select: {
        id: true,
        supplier: true,
        amount: true,
        date: true,
        invoiceNumber: true,
        documentFingerprint: true,
        createdAt: true,
        paid: true,
      },
      take: 20,
    });

    // Live bezeq attachment size + gmail OCR cue via search
    const env = await loadRenderEnv();
    if (env.SECRETS_ENCRYPTION_KEY) process.env.SECRETS_ENCRYPTION_KEY = env.SECRETS_ENCRYPTION_KEY;
    const raw = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    });
    const integration = decryptIntegrationTokens(raw!);
    const oauth2 = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_INTEGRATION_REDIRECT_URI ||
        "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback",
    );
    oauth2.setCredentials({ refresh_token: integration.refreshToken! });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const qHits = await gmail.users.messages.list({
      userId: "me",
      q: `rfc822msgid: OR id:${BEZEQ_MSG}`,
      maxResults: 1,
    });
    const negationHit = await gmail.users.messages.list({
      userId: "me",
      q: `"אינו מהווה חשבונית" newer_than:1d`,
      maxResults: 5,
    });
    const full = await gmail.users.messages.get({ userId: "me", id: BEZEQ_MSG, format: "full" });
    const atts: any[] = [];
    const walk = (p: any) => {
      if (!p) return;
      if (p.body?.attachmentId) atts.push({ filename: p.filename, mimeType: p.mimeType, size: p.body.size, attachmentId: p.body.attachmentId });
      for (const c of p.parts || []) walk(c);
    };
    walk(full.data.payload);
    const att = atts[0];
    const downloaded = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: BEZEQ_MSG,
      id: att.attachmentId,
    });
    const buf = Buffer.from((downloaded.data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");

    const out = {
      countNeeds,
      rnetInNeeds,
      bezeqInNeeds,
      rnetRankAmongTop40: rnetRank,
      bezeqRankAmongTop40: bezeqRank,
      top10: topFdr.slice(0, 10),
      includesRnetInTop40: rnetRank >= 0,
      includesBezeqInTop40: bezeqRank >= 0,
      payments,
      bezeqLive: {
        messageId: BEZEQ_MSG,
        filename: att?.filename,
        mimeType: att?.mimeType,
        declaredSize: att?.size,
        bytes: buf.length,
        gmailNegationSearchIds: (negationHit.data.messages || []).map((m) => m.id),
        gmailNegationIncludesBezeqMsg: (negationHit.data.messages || []).some((m) => m.id === BEZEQ_MSG),
      },
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-rank-diag.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
