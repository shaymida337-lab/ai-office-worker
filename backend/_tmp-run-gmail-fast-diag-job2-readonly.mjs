/**
 * READ-ONLY Render job: ASCII-only base64 payload to avoid encoding corruption.
 * Lists Gmail queries + message metadata for Shay mailbox.
 */
import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) throw new Error("RENDER_API_KEY missing");

const remoteSource = `
const ORG = "cmpjd7j7e0001bl5tzv049rxb";
(async () => {
  const { getGoogleClients } = require("./dist/services/google.js");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  function headersOf(payload) {
    const out = {};
    for (const h of payload?.headers || []) if (h?.name) out[String(h.name).toLowerCase()] = h.value;
    return out;
  }
  function atts(payload, acc = []) {
    if (!payload) return acc;
    if (payload.filename || payload.body?.attachmentId) {
      acc.push({ filename: payload.filename || null, mimeType: payload.mimeType || null, size: payload.body?.size ?? null });
    }
    for (const p of payload.parts || []) atts(p, acc);
    return acc;
  }
  async function list(gmail, q) {
    const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
    return { query: q, count: (r.data.messages || []).length, estimate: r.data.resultSizeEstimate ?? null, ids: (r.data.messages || []).map((m) => m.id).filter(Boolean) };
  }
  async function describe(gmail, id) {
    const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const h = headersOf(r.data.payload);
    const labelIds = r.data.labelIds || [];
    return {
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
      categorySocial: labelIds.includes("CATEGORY_SOCIAL"),
      categoryUpdates: labelIds.includes("CATEGORY_UPDATES"),
      attachments: atts(r.data.payload).filter((a) => a.filename || (a.mimeType && (a.mimeType.startsWith("image/") || a.mimeType.startsWith("application/")))),
    };
  }
  try {
    const { gmail } = await getGoogleClients(ORG);
    const profile = await gmail.users.getProfile({ userId: "me" });
    const queries = [
      "newer_than:1d has:attachment -in:spam -in:trash",
      "newer_than:1d has:attachment",
      "newer_than:1d",
      "newer_than:1d in:inbox",
      "newer_than:1d in:sent",
      "newer_than:1d in:sent has:attachment",
      "newer_than:1d filename:pdf",
      "newer_than:1d (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png OR filename:webp)",
      "newer_than:1d subject:invoice",
      "newer_than:1d subject:receipt",
      "newer_than:2d has:attachment",
      "newer_than:7d has:attachment -in:spam -in:trash",
      "after:2026/07/25 has:attachment",
      "after:2026/07/25",
      "in:inbox newer_than:1d",
      "is:unread newer_than:1d",
      "has:userlabels newer_than:1d has:attachment",
    ];
    const queryResults = [];
    for (const q of queries) {
      try { queryResults.push(await list(gmail, q)); }
      catch (e) { queryResults.push({ query: q, count: 0, ids: [], error: String(e && e.message || e) }); }
    }
    const ids = [...new Set(queryResults.flatMap((r) => r.ids || []))].slice(0, 50);
    const messages = [];
    for (const id of ids) messages.push(await describe(gmail, id));
    messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    const since6h = Date.now() - 6 * 3600e3;
    const recent6 = messages.filter((m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since6h);
    const gids = messages.map((m) => m.id);
    const gsi = gids.length ? await prisma.gmailScanItem.findMany({ where: { organizationId: ORG, gmailMessageId: { in: gids } }, select: { id: true, gmailMessageId: true, reviewStatus: true, decisionReason: true, attachmentFilename: true, createdAt: true } }) : [];
    const fdr = gids.length ? await prisma.financialDocumentReview.findMany({ where: { organizationId: ORG, gmailMessageId: { in: gids } }, select: { id: true, gmailMessageId: true, reviewStatus: true, uncertaintyReason: true, fileName: true, createdAt: true } }) : [];
    const fastPrimary = queryResults.find((r) => r.query === "newer_than:1d has:attachment -in:spam -in:trash");
    const broad = queryResults.find((r) => r.query === "newer_than:1d has:attachment");
    const any1d = queryResults.find((r) => r.query === "newer_than:1d");
    console.log("GMAIL_FAST_DIAG_BEGIN");
    console.log(JSON.stringify({
      now: new Date().toISOString(),
      mailboxEmail: profile.data.emailAddress || null,
      messagesTotalReturned: profile.data.messagesTotal ?? null,
      threadsTotal: profile.data.threadsTotal ?? null,
      queryResults: queryResults.map((r) => ({ query: r.query, count: r.count, estimate: r.estimate ?? null, error: r.error || null, sampleIds: (r.ids || []).slice(0, 8) })),
      compare: {
        fastPrimaryCount: fastPrimary ? fastPrimary.count : 0,
        broadHasAttachmentCount: broad ? broad.count : 0,
        anyNewerThan1dCount: any1d ? any1d.count : 0,
        onlyInBroadNotFast: (broad && broad.ids || []).filter((id) => !(fastPrimary && fastPrimary.ids || []).includes(id)),
      },
      recentLast6h: recent6,
      newest20: messages.slice(0, 20),
      alreadyInDb: { gsi, fdr },
    }));
    console.log("GMAIL_FAST_DIAG_END");
  } catch (e) {
    console.log("GMAIL_FAST_DIAG_ERROR " + String(e && e.stack || e));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
`;

const b64 = Buffer.from(remoteSource, "utf8").toString("base64");
const startCommand = `node -e "require('fs').writeFileSync('gmail-fast-diag.js', Buffer.from('${b64}','base64')); require('child_process').execSync('node gmail-fast-diag.js', {stdio:'inherit'});"`;

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function main() {
  const create = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ startCommand }),
    signal: AbortSignal.timeout(30_000),
  });
  const createText = await create.text();
  if (!create.ok) throw new Error(`create failed ${create.status} ${createText.slice(0, 500)}`);
  const jobId = JSON.parse(createText).id ?? JSON.parse(createText).job?.id;
  console.log(JSON.stringify({ jobId }));

  let status = "";
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs/${jobId}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const body = await st.json();
    status = body.status ?? body.job?.status ?? "";
    console.log(JSON.stringify({ poll: i, status }));
    if (["succeeded", "failed", "canceled", "cancelled"].includes(String(status).toLowerCase())) break;
  }

  const owner = "tea-d86903gg4nts73abte2g";
  const end = new Date();
  const start = new Date(Date.now() - 25 * 60 * 1000);
  const url =
    `https://api.render.com/v1/logs?ownerId=${owner}&resource=${SERVICE_ID}` +
    `&limit=100&direction=backward` +
    `&startTime=${encodeURIComponent(start.toISOString())}` +
    `&endTime=${encodeURIComponent(end.toISOString())}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  const payload = await res.json();
  const logs = (payload.logs ?? []).map((e) => e.message ?? "").join("\n");
  writeFileSync(join(process.cwd(), "_tmp-gmail-fast-query-job-logs.txt"), logs, "utf8");
  const begin = logs.indexOf("GMAIL_FAST_DIAG_BEGIN");
  const endMark = logs.indexOf("GMAIL_FAST_DIAG_END");
  const errMark = logs.indexOf("GMAIL_FAST_DIAG_ERROR");
  if (begin >= 0 && endMark > begin) {
    const jsonText = logs.slice(begin + "GMAIL_FAST_DIAG_BEGIN".length, endMark).trim();
    writeFileSync(join(process.cwd(), "_tmp-gmail-fast-query-diag.json"), jsonText, "utf8");
    console.log("WROTE_DIAG");
    console.log(jsonText.slice(0, 2500));
  } else if (errMark >= 0) {
    console.log(logs.slice(errMark, errMark + 1500));
  } else {
    console.log("NO_MARKERS status=" + status);
    console.log(logs.slice(0, 2500));
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
