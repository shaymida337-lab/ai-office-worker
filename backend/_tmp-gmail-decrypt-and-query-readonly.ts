/**
 * READ-ONLY: decrypt prod Gmail tokens with Render SECRETS_ENCRYPTION_KEY, run queries.
 * Never prints secrets/tokens.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { decryptIntegrationTokens } from "./src/lib/integrationSecrets.ts";
import {
  buildFastScanQueries,
  FAST_SCAN_DATE_FILTER,
} from "./src/services/gmailFastScanQuery.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmpjd7j7e0001bl5tzv049rxb";
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

function headersOf(payload) {
  const out = {};
  for (const h of payload?.headers || []) if (h?.name) out[String(h.name).toLowerCase()] = h.value;
  return out;
}
function atts(payload, acc = []) {
  if (!payload) return acc;
  if (payload.filename || payload.body?.attachmentId) {
    acc.push({
      filename: payload.filename || null,
      mimeType: payload.mimeType || null,
      size: payload.body?.size ?? null,
    });
  }
  for (const p of payload.parts || []) atts(p, acc);
  return acc;
}

async function main() {
  const renderEnv = await loadRenderEnv();
  // Ensure decrypt uses production key
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
    if (!integration.refreshToken) throw new Error("no refresh token after decrypt");

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({
      access_token: integration.accessToken ?? undefined,
      refresh_token: integration.refreshToken,
      expiry_date: integration.expiresAt?.getTime(),
    });
    // Force refresh for a clean token
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: "me" });

    const fastQueries = buildFastScanQueries();
    const comparisonQueries = [
      "newer_than:1d has:attachment",
      "newer_than:1d has:attachment -in:spam -in:trash",
      "newer_than:1d",
      "newer_than:1d in:inbox",
      "newer_than:1d in:sent has:attachment",
      "newer_than:1d filename:pdf",
      "newer_than:1d (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)",
      "newer_than:1d subject:invoice",
      "newer_than:1d subject:receipt",
      "newer_than:2d has:attachment -in:spam -in:trash",
      "after:2026/07/25 has:attachment",
      "after:2026/07/25",
      "is:unread newer_than:1d",
      "newer_than:1d -in:spam -in:trash",
    ];

    const queryResults = [];
    for (const q of [...fastQueries, ...comparisonQueries]) {
      try {
        const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
        queryResults.push({
          query: q,
          count: (r.data.messages || []).length,
          estimate: r.data.resultSizeEstimate ?? null,
          ids: (r.data.messages || []).map((m) => m.id).filter(Boolean),
        });
      } catch (e) {
        queryResults.push({
          query: q,
          count: 0,
          ids: [],
          error: String(e?.message ?? e),
        });
      }
    }

    const ids = [...new Set(queryResults.flatMap((r) => r.ids || []))].slice(0, 50);
    const messages = [];
    for (const id of ids) {
      const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const h = headersOf(r.data.payload);
      const labelIds = r.data.labelIds || [];
      messages.push({
        id,
        receivedAt: r.data.internalDate
          ? new Date(Number(r.data.internalDate)).toISOString()
          : null,
        sender: h.from || null,
        to: h.to || null,
        subject: h.subject || null,
        labelIds,
        inSpam: labelIds.includes("SPAM"),
        inTrash: labelIds.includes("TRASH"),
        inInbox: labelIds.includes("INBOX"),
        inSent: labelIds.includes("SENT"),
        categoryPromotions: labelIds.includes("CATEGORY_PROMOTIONS"),
        categoryUpdates: labelIds.includes("CATEGORY_UPDATES"),
        categorySocial: labelIds.includes("CATEGORY_SOCIAL"),
        attachments: atts(r.data.payload).filter(
          (a) =>
            a.filename ||
            (a.mimeType &&
              (a.mimeType.startsWith("image/") || a.mimeType.startsWith("application/")))
        ),
      });
    }
    messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));

    const since3h = Date.now() - 3 * 3600e3;
    const since6h = Date.now() - 6 * 3600e3;
    const withAtt = (m) => (m.attachments || []).length > 0;
    const recent3 = messages.filter(
      (m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since3h && withAtt(m)
    );
    const recent6 = messages.filter(
      (m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since6h && withAtt(m)
    );

    const gids = messages.map((m) => m.id);
    const [gsi, fdr] = await Promise.all([
      gids.length
        ? prisma.gmailScanItem.findMany({
            where: { organizationId: ORG, gmailMessageId: { in: gids } },
            select: {
              id: true,
              gmailMessageId: true,
              reviewStatus: true,
              decisionReason: true,
              attachmentFilename: true,
              createdAt: true,
            },
          })
        : [],
      gids.length
        ? prisma.financialDocumentReview.findMany({
            where: { organizationId: ORG, gmailMessageId: { in: gids } },
            select: {
              id: true,
              gmailMessageId: true,
              reviewStatus: true,
              uncertaintyReason: true,
              fileName: true,
              createdAt: true,
            },
          })
        : [],
    ]);

    const fastPrimary = queryResults.find(
      (r) => r.query === `${FAST_SCAN_DATE_FILTER} has:attachment -in:spam -in:trash`
    );
    const broad = queryResults.find((r) => r.query === "newer_than:1d has:attachment");
    const any1d = queryResults.find((r) => r.query === "newer_than:1d");

    const out = {
      now: new Date().toISOString(),
      mailboxEmail: profile.data.emailAddress || null,
      messagesTotal: profile.data.messagesTotal ?? null,
      fastScanDateFilter: FAST_SCAN_DATE_FILTER,
      fastQueries,
      queryResults: queryResults.map((r) => ({
        query: r.query,
        count: r.count,
        estimate: r.estimate ?? null,
        error: r.error || null,
        sampleIds: (r.ids || []).slice(0, 8),
      })),
      compare: {
        fastPrimaryCount: fastPrimary?.count ?? 0,
        broadHasAttachmentCount: broad?.count ?? 0,
        anyNewerThan1dCount: any1d?.count ?? 0,
        onlyInBroadNotFast: (broad?.ids || []).filter(
          (id) => !(fastPrimary?.ids || []).includes(id)
        ),
      },
      recentWithAttachmentsLast3h: recent3,
      recentWithAttachmentsLast6h: recent6,
      newest20: messages.slice(0, 20),
      alreadyInDb: {
        gsi: gsi.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        fdr: fdr.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      },
    };
    writeFileSync(join(process.cwd(), "_tmp-gmail-fast-query-diag.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
