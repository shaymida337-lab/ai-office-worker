/**
 * READ-ONLY follow-up: list ALL newer_than:1d messages + spam/sent/all variants.
 * Uses decrypt + Render Google OAuth. No token printing.
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
    const raw = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    });
    const integration = decryptIntegrationTokens(raw);
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({ refresh_token: integration.refreshToken });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const queries = [
      "newer_than:1d",
      "newer_than:1d in:sent",
      "newer_than:1d in:spam",
      "newer_than:1d in:trash",
      "newer_than:1d has:attachment in:spam",
      "newer_than:1d has:attachment in:trash",
      "newer_than:1d larger:50k",
      "newer_than:1d larger:100k",
      "newer_than:3d has:attachment",
      "newer_than:7d has:attachment -in:spam -in:trash",
      "has:attachment after:2026/07/26",
      "filename:pdf after:2026/07/25",
      "filename:jpg after:2026/07/25 OR filename:jpeg after:2026/07/25 OR filename:png after:2026/07/25",
    ];

    const queryResults = [];
    for (const q of queries) {
      try {
        const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
        queryResults.push({
          query: q,
          count: (r.data.messages || []).length,
          estimate: r.data.resultSizeEstimate ?? null,
          ids: (r.data.messages || []).map((m) => m.id).filter(Boolean),
        });
      } catch (e) {
        queryResults.push({ query: q, count: 0, ids: [], error: String(e?.message ?? e) });
      }
    }

    const ids = [...new Set(queryResults.flatMap((r) => r.ids || []))];
    const messages = [];
    for (const id of ids) {
      const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const h = headersOf(r.data.payload);
      const labelIds = r.data.labelIds || [];
      const allAtt = atts(r.data.payload);
      messages.push({
        id,
        receivedAt: r.data.internalDate
          ? new Date(Number(r.data.internalDate)).toISOString()
          : null,
        sender: h.from || null,
        to: h.to || null,
        subject: h.subject || null,
        snippet: (r.data.snippet || "").slice(0, 120),
        labelIds,
        inSpam: labelIds.includes("SPAM"),
        inTrash: labelIds.includes("TRASH"),
        inInbox: labelIds.includes("INBOX"),
        inSent: labelIds.includes("SENT"),
        sizeEstimate: r.data.sizeEstimate ?? null,
        attachments: allAtt.filter(
          (a) =>
            a.filename ||
            (a.mimeType &&
              (a.mimeType.startsWith("image/") ||
                a.mimeType.startsWith("application/") ||
                a.mimeType === "application/pdf"))
        ),
        rawAttachmentParts: allAtt.slice(0, 8),
      });
    }
    messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));

    const withFiles = messages.filter((m) => (m.attachments || []).some((a) => a.filename));
    const since6h = Date.now() - 6 * 3600e3;
    const recent6 = messages.filter(
      (m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since6h
    );

    const out = {
      now: new Date().toISOString(),
      queryResults: queryResults.map((r) => ({
        query: r.query,
        count: r.count,
        estimate: r.estimate ?? null,
        error: r.error || null,
        sampleIds: (r.ids || []).slice(0, 10),
      })),
      totalUniqueMessagesDescribed: messages.length,
      messagesWithFilenames: withFiles,
      recentLast6hAll: recent6,
      allMessagesCompact: messages.map((m) => ({
        id: m.id,
        receivedAt: m.receivedAt,
        sender: m.sender,
        subject: m.subject,
        inInbox: m.inInbox,
        inSent: m.inSent,
        inSpam: m.inSpam,
        sizeEstimate: m.sizeEstimate,
        attachmentFilenames: (m.attachments || []).map((a) => a.filename).filter(Boolean),
        attachmentMimes: (m.attachments || []).map((a) => a.mimeType),
      })),
    };
    writeFileSync(
      join(process.cwd(), "_tmp-gmail-all-1d-messages.json"),
      JSON.stringify(out, null, 2),
      "utf8"
    );
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
