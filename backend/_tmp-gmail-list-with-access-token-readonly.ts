/**
 * READ-ONLY: use currently-stored Gmail access token (no refresh) to list queries.
 * Never prints token values.
 */
import { existsSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmpjd7j7e0001bl5tzv049rxb";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW flag" }));
  process.exit(2);
}

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

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
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    select: { accessToken: true, expiresAt: true, updatedAt: true, metadata: true },
  });
  if (!integration?.accessToken) {
    console.log(JSON.stringify({ error: "no access token in DB" }));
    return;
  }

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: integration.accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  let profile;
  try {
    profile = await gmail.users.getProfile({ userId: "me" });
  } catch (e) {
    console.log(
      JSON.stringify({
        error: "access_token_unusable",
        detail: String(e?.message ?? e),
        expiresAt: integration.expiresAt,
        updatedAt: integration.updatedAt,
        now: new Date().toISOString(),
      })
    );
    return;
  }

  const queries = [
    "newer_than:1d has:attachment -in:spam -in:trash",
    "newer_than:1d has:attachment",
    "newer_than:1d",
    "newer_than:1d in:inbox",
    "newer_than:1d in:sent has:attachment",
    "newer_than:1d filename:pdf",
    "newer_than:1d (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)",
    "newer_than:2d has:attachment",
    "after:2026/07/25 has:attachment",
    "after:2026/07/25",
    "is:unread newer_than:1d",
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

  const ids = [...new Set(queryResults.flatMap((r) => r.ids || []))].slice(0, 40);
  const messages = [];
  for (const id of ids) {
    const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const h = headersOf(r.data.payload);
    const labelIds = r.data.labelIds || [];
    messages.push({
      id,
      receivedAt: r.data.internalDate ? new Date(Number(r.data.internalDate)).toISOString() : null,
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
      attachments: atts(r.data.payload).filter(
        (a) =>
          a.filename ||
          (a.mimeType && (a.mimeType.startsWith("image/") || a.mimeType.startsWith("application/")))
      ),
    });
  }
  messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));

  const since6h = Date.now() - 6 * 3600e3;
  const recent6 = messages.filter((m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since6h);

  const gids = messages.map((m) => m.id);
  const gsi = gids.length
    ? await prisma.gmailScanItem.findMany({
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
    : [];
  const fdr = gids.length
    ? await prisma.financialDocumentReview.findMany({
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
    : [];

  const fastPrimary = queryResults.find((r) => r.query === "newer_than:1d has:attachment -in:spam -in:trash");
  const broad = queryResults.find((r) => r.query === "newer_than:1d has:attachment");
  const any1d = queryResults.find((r) => r.query === "newer_than:1d");

  console.log(
    JSON.stringify(
      {
        now: new Date().toISOString(),
        authMode: "stored_access_token_no_refresh",
        mailboxEmail: profile.data.emailAddress || null,
        tokenExpiresAt: integration.expiresAt,
        messagesTotal: profile.data.messagesTotal ?? null,
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
          onlyInBroadNotFast: (broad?.ids || []).filter((id) => !(fastPrimary?.ids || []).includes(id)),
        },
        recentLast6h: recent6,
        newest20: messages.slice(0, 20),
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
