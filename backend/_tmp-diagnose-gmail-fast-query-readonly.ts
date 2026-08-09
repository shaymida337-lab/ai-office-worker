/**
 * READ-ONLY: diagnose why fast_recurring finds 0 for Shay's 3 invoice emails.
 * No DB writes. No token values logged.
 *
 * Requires: ALLOW_REMOTE_READONLY_REPORT=1, PROD_DATABASE_URL, GOOGLE_CLIENT_*
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
if (existsSync(join(process.cwd(), "..", ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), "..", ".env.prod.local"), override: false });
}

const ORG_ID = process.env.VERIFY_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || /localhost|127\.0\.0\.1/.test(prodUrl)) {
  console.error(JSON.stringify({ error: "PROD_DATABASE_URL required" }));
  process.exit(2);
}
if (process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "Set ALLOW_REMOTE_READONLY_REPORT=1" }));
  process.exit(2);
}

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error(JSON.stringify({ error: "GOOGLE_CLIENT_ID/SECRET required" }));
  process.exit(2);
}

const redirectUris = [
  process.env.GOOGLE_INTEGRATION_REDIRECT_URI?.trim(),
  process.env.GOOGLE_REDIRECT_URI?.trim(),
  "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback",
  "https://ai-office-worker-backend.onrender.com/auth/google/callback",
].filter(Boolean);

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
u.searchParams.set("connection_limit", "3");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

async function getGmailClient(refreshToken) {
  let lastErr = "no redirect worked";
  for (const redirect of [...new Set(redirectUris)]) {
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

async function listIds(gmail, q, maxResults = 50) {
  const res = await gmail.users.messages.list({ userId: "me", q, maxResults });
  return {
    query: q,
    resultSizeEstimate: res.data.resultSizeEstimate ?? null,
    count: (res.data.messages ?? []).length,
    ids: (res.data.messages ?? []).map((m) => m.id).filter(Boolean),
  };
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
  if (filename || (mime && mime !== "multipart/mixed" && mime !== "multipart/alternative" && mime !== "multipart/related" && payload.body?.attachmentId)) {
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

async function describeMessage(gmail, id) {
  const res = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
    metadataHeaders: ["From", "To", "Subject", "Date"],
  });
  const headers = headerMap(res.data.payload?.headers);
  const attachments = collectAttachments(res.data.payload);
  const labelIds = res.data.labelIds ?? [];
  return {
    id,
    threadId: res.data.threadId,
    snippet: res.data.snippet,
    internalDate: res.data.internalDate
      ? new Date(Number(res.data.internalDate)).toISOString()
      : null,
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
    attachments,
  };
}

async function main() {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: ORG_ID, provider: "gmail" } },
    select: {
      id: true,
      refreshToken: true,
      accessToken: true,
      expiresAt: true,
      metadata: true,
      updatedAt: true,
    },
  });
  if (!integration?.refreshToken) {
    console.log(JSON.stringify({ error: "No gmail refresh token for org", ORG_ID }, null, 2));
    return;
  }

  const { gmail, emailAddress, redirect } = await getGmailClient(integration.refreshToken);

  const fastQueries = buildFastScanQueries();
  const comparisonQueries = [
    "newer_than:1d has:attachment",
    "newer_than:1d has:attachment -in:spam -in:trash",
    "newer_than:1d has:attachment -in:spam -in:trash -in:sent",
    "newer_than:1d",
    "newer_than:1d in:inbox",
    "newer_than:1d in:sent has:attachment",
    "newer_than:1d filename:pdf",
    "newer_than:1d filename:jpg OR filename:jpeg OR filename:png OR filename:pdf",
    "newer_than:1d subject:חשבונית",
    "newer_than:1d subject:invoice",
    "newer_than:2d has:attachment -in:spam -in:trash",
    "after:2026/07/25 has:attachment -in:spam -in:trash",
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

  // Union of all message ids from broad attachment queries
  const broad = queryResults.find((r) => r.query === "newer_than:1d has:attachment");
  const fastPrimary = queryResults.find(
    (r) => r.query === `${FAST_SCAN_DATE_FILTER} has:attachment -in:spam -in:trash`
  );

  const candidateIds = [
    ...new Set([
      ...(broad?.ids ?? []),
      ...(fastPrimary?.ids ?? []),
      ...queryResults.flatMap((r) => (r.count > 0 ? r.ids : [])),
    ]),
  ].slice(0, 40);

  const messages = [];
  for (const id of candidateIds) {
    messages.push(await describeMessage(gmail, id));
  }

  // Sort newest first
  messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));

  // Already-processed check in DB
  const gmailIds = messages.map((m) => m.id);
  const existingGsi = gmailIds.length
    ? await prisma.gmailScanItem.findMany({
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
    : [];
  const existingFdr = gmailIds.length
    ? await prisma.financialDocumentReview.findMany({
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
    : [];
  const existingEmail = gmailIds.length
    ? await prisma.emailMessage.findMany({
        where: { organizationId: ORG_ID, gmailId: { in: gmailIds } },
        select: { id: true, gmailId: true, subject: true, createdAt: true },
      })
    : [];

  // Focus: messages from last ~3 hours with attachments (likely the 3 invoices)
  const since3h = Date.now() - 3 * 60 * 60 * 1000;
  const recentWithAtt = messages.filter(
    (m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since3h && (m.attachments?.length ?? 0) > 0
  );

  const fastQueryHits = Object.fromEntries(
    fastQueries.map((q) => {
      const row = queryResults.find((r) => r.query === q);
      return [q, { count: row?.count ?? 0, ids: row?.ids ?? [], error: row?.error ?? null }];
    })
  );

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        orgId: ORG_ID,
        mailboxEmail: emailAddress,
        redirectUsed: redirect,
        tokenExpiresAt: integration.expiresAt?.toISOString?.() ?? integration.expiresAt,
        fastScanDateFilter: FAST_SCAN_DATE_FILTER,
        fastQueries,
        queryResults: queryResults.map((r) => ({
          query: r.query,
          count: r.count,
          resultSizeEstimate: r.resultSizeEstimate ?? null,
          error: r.error ?? null,
          sampleIds: (r.ids ?? []).slice(0, 5),
        })),
        fastPrimaryVsBroad: {
          fastPrimaryQuery: fastPrimary?.query,
          fastPrimaryCount: fastPrimary?.count ?? 0,
          broadQuery: broad?.query,
          broadCount: broad?.count ?? 0,
          onlyInBroad: (broad?.ids ?? []).filter((id) => !(fastPrimary?.ids ?? []).includes(id)),
          onlyInFast: (fastPrimary?.ids ?? []).filter((id) => !(broad?.ids ?? []).includes(id)),
        },
        recentWithAttachmentsLast3h: recentWithAtt,
        allDescribedMessagesLastDaySample: messages.slice(0, 15),
        alreadyInDb: {
          gsi: existingGsi.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
          })),
          fdr: existingFdr.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
          })),
          emailMessage: existingEmail.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
          })),
        },
        fastQueryHits,
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
