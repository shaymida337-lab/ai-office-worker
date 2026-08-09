/**
 * Fetch Render Google OAuth client credentials (keys only, no secrets printed),
 * then diagnose Shay Gmail fast queries read-only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import {
  buildFastScanQueries,
  FAST_SCAN_DATE_FILTER,
} from "./src/services/gmailFastScanQuery.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG_ID = "cmpjd7j7e0001bl5tzv049rxb";
const BACKEND = "srv-d898po77f7vs73bu01v0";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
const renderKey = process.env.RENDER_API_KEY?.trim();

if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD_DATABASE_URL + ALLOW_REMOTE_READONLY_REPORT=1" }));
  process.exit(2);
}
if (!renderKey) {
  console.error(JSON.stringify({ error: "RENDER_API_KEY required" }));
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
    const cursor = data[data.length - 1]?.cursor;
    if (!cursor || data.length < 100) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  return out;
}

function headerMap(headers = []) {
  const out = {};
  for (const h of headers) {
    if (h?.name && h.value != null) out[h.name.toLowerCase()] = h.value;
  }
  return out;
}

function collectAttachments(payload, acc = []) {
  if (!payload) return acc;
  const filename = payload.filename || "";
  const mime = payload.mimeType || "";
  if (filename || payload.body?.attachmentId) {
    if (filename || payload.body?.attachmentId) {
      acc.push({
        filename: filename || null,
        mimeType: mime || null,
        size: payload.body?.size ?? null,
      });
    }
  }
  for (const part of payload.parts ?? []) collectAttachments(part, acc);
  return acc;
}

async function listIds(gmail, q, maxResults = 50) {
  const res = await gmail.users.messages.list({ userId: "me", q, maxResults });
  return {
    query: q,
    resultSizeEstimate: res.data.resultSizeEstimate ?? null,
    count: (res.data.messages ?? []).length,
    ids: (res.data.messages ?? []).map((m) => m.id).filter(Boolean),
  };
}

async function describeMessage(gmail, id) {
  const res = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  const headers = headerMap(res.data.payload?.headers);
  const attachments = collectAttachments(res.data.payload).filter(
    (a) => a.filename || a.mimeType?.startsWith("application/") || a.mimeType?.startsWith("image/")
  );
  const labelIds = res.data.labelIds ?? [];
  return {
    id,
    threadId: res.data.threadId,
    snippet: (res.data.snippet ?? "").slice(0, 160),
    receivedAt: res.data.internalDate
      ? new Date(Number(res.data.internalDate)).toISOString()
      : null,
    sender: headers.from ?? null,
    to: headers.to ?? null,
    subject: headers.subject ?? null,
    dateHeader: headers.date ?? null,
    labelIds,
    inSpam: labelIds.includes("SPAM"),
    inTrash: labelIds.includes("TRASH"),
    inInbox: labelIds.includes("INBOX"),
    inSent: labelIds.includes("SENT"),
    categoryPersonal: labelIds.includes("CATEGORY_PERSONAL"),
    categoryPromotions: labelIds.includes("CATEGORY_PROMOTIONS"),
    categoryUpdates: labelIds.includes("CATEGORY_UPDATES"),
    categorySocial: labelIds.includes("CATEGORY_SOCIAL"),
    attachments,
  };
}

async function getGmail(refreshToken, clientId, clientSecret, redirectUris) {
  let lastErr = "no redirect worked";
  for (const redirect of redirectUris) {
    try {
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirect);
      oauth2.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const profile = await gmail.users.getProfile({ userId: "me" });
      return { gmail, emailAddress: profile.data.emailAddress, redirect };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
u.searchParams.set("connection_limit", "3");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

async function main() {
  const renderEnv = await loadRenderEnv();
  const clientId = renderEnv.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = renderEnv.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.log(JSON.stringify({ error: "Render missing GOOGLE_CLIENT_ID/SECRET", hasId: !!clientId }));
    process.exit(2);
  }

  const redirectUris = [
    ...new Set(
      [
        renderEnv.GOOGLE_INTEGRATION_REDIRECT_URI,
        renderEnv.GOOGLE_REDIRECT_URI,
        "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback",
        "https://ai-office-worker-backend.onrender.com/auth/google/callback",
      ].filter(Boolean)
    ),
  ];

  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: ORG_ID, provider: "gmail" } },
    select: { refreshToken: true, expiresAt: true, metadata: true, updatedAt: true },
  });
  if (!integration?.refreshToken) {
    console.log(JSON.stringify({ error: "no gmail refresh token" }));
    process.exit(2);
  }

  const { gmail, emailAddress, redirect } = await getGmail(
    integration.refreshToken,
    clientId,
    clientSecret,
    redirectUris
  );

  const fastQueries = buildFastScanQueries();
  const comparisonQueries = [
    "newer_than:1d has:attachment",
    "newer_than:1d has:attachment -in:spam -in:trash",
    "newer_than:1d",
    "newer_than:1d in:inbox",
    "newer_than:1d in:sent has:attachment",
    "newer_than:1d filename:pdf",
    "newer_than:1d (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)",
    "newer_than:1d subject:חשבונית",
    "newer_than:1d subject:invoice",
    "newer_than:2d has:attachment -in:spam -in:trash",
    "after:2026/07/25 has:attachment -in:spam -in:trash",
    "newer_than:1d -in:spam -in:trash",
  ];

  const queryResults = [];
  for (const q of [...fastQueries, ...comparisonQueries]) {
    try {
      queryResults.push(await listIds(gmail, q, 50));
    } catch (e) {
      queryResults.push({
        query: q,
        error: e instanceof Error ? e.message : String(e),
        count: 0,
        ids: [],
      });
    }
  }

  const broad = queryResults.find((r) => r.query === "newer_than:1d has:attachment");
  const fastPrimary = queryResults.find(
    (r) => r.query === `${FAST_SCAN_DATE_FILTER} has:attachment -in:spam -in:trash`
  );

  const candidateIds = [...new Set(queryResults.flatMap((r) => r.ids ?? []))].slice(0, 40);
  const messages = [];
  for (const id of candidateIds) {
    messages.push(await describeMessage(gmail, id));
  }
  messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));

  const since3h = Date.now() - 3 * 60 * 60 * 1000;
  const since6h = Date.now() - 6 * 60 * 60 * 1000;
  const recent3h = messages.filter(
    (m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since3h && (m.attachments?.length ?? 0) > 0
  );
  const recent6h = messages.filter(
    (m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since6h && (m.attachments?.length ?? 0) > 0
  );

  const gmailIds = messages.map((m) => m.id);
  const [gsi, fdr] = await Promise.all([
    gmailIds.length
      ? prisma.gmailScanItem.findMany({
          where: { organizationId: ORG_ID, gmailMessageId: { in: gmailIds } },
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
    gmailIds.length
      ? prisma.financialDocumentReview.findMany({
          where: { organizationId: ORG_ID, gmailMessageId: { in: gmailIds } },
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

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        mailboxEmail: emailAddress,
        redirectUsed: redirect,
        oauthClientSource: "render",
        oauthClientIdSuffix: clientId.slice(-8),
        fastScanDateFilter: FAST_SCAN_DATE_FILTER,
        queryResults: queryResults.map((r) => ({
          query: r.query,
          count: r.count,
          resultSizeEstimate: r.resultSizeEstimate ?? null,
          error: r.error ?? null,
          sampleIds: (r.ids ?? []).slice(0, 5),
        })),
        fastPrimaryVsBroad: {
          fastPrimaryQuery: fastPrimary?.query ?? null,
          fastPrimaryCount: fastPrimary?.count ?? 0,
          broadQuery: broad?.query ?? null,
          broadCount: broad?.count ?? 0,
          onlyInBroadNotFast: (broad?.ids ?? []).filter((id) => !(fastPrimary?.ids ?? []).includes(id)),
        },
        recentWithAttachmentsLast3h: recent3h,
        recentWithAttachmentsLast6h: recent6h,
        newest15: messages.slice(0, 15),
        alreadyInDb: {
          gsi: gsi.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
          fdr: fdr.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
