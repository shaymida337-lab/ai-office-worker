/**
 * READ-ONLY: EmailMessage processedAt + how quick scan could report found=0
 * for messages that match fast queries.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { decryptIntegrationTokens } from "./src/lib/integrationSecrets.ts";
import { buildFastScanQueries, FAST_SCAN_DATE_FILTER } from "./src/services/gmailFastScanQuery.ts";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const RNET = "19f9e3d9101ed94d";
const BEZEQ = "19f9e3d4a3621e8d";
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
  const renderEnv = await loadRenderEnv();
  if (renderEnv.SECRETS_ENCRYPTION_KEY) process.env.SECRETS_ENCRYPTION_KEY = renderEnv.SECRETS_ENCRYPTION_KEY;
  const u = new URL(prodUrl);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const emails = await prisma.emailMessage.findMany({
      where: { organizationId: ORG, gmailId: { in: [RNET, BEZEQ] } },
      select: {
        id: true,
        gmailId: true,
        subject: true,
        fromAddress: true,
        receivedAt: true,
        processedAt: true,
        createdAt: true,
        snippet: true,
        source: true,
      },
    });
    const attachments = emails.length
      ? await prisma.emailAttachment.findMany({
          where: { emailMessageId: { in: emails.map((e) => e.id) } },
          select: {
            id: true,
            emailMessageId: true,
            filename: true,
            mimeType: true,
            size: true,
            driveUploadStatus: true,
            createdAt: true,
          },
        })
      : [];

    // Any recent EmailMessage without processedAt?
    const recentUnprocessed = await prisma.emailMessage.findMany({
      where: {
        organizationId: ORG,
        receivedAt: { gte: new Date("2026-07-26T11:00:00Z") },
      },
      select: {
        id: true,
        gmailId: true,
        fromAddress: true,
        subject: true,
        receivedAt: true,
        processedAt: true,
        createdAt: true,
      },
      orderBy: { receivedAt: "desc" },
      take: 20,
    });

    // Live Gmail: simulate first fast query list
    const raw = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: ORG, provider: "gmail" } },
    });
    const integration = decryptIntegrationTokens(raw!);
    const oauth2 = new google.auth.OAuth2(
      renderEnv.GOOGLE_CLIENT_ID,
      renderEnv.GOOGLE_CLIENT_SECRET,
      renderEnv.GOOGLE_INTEGRATION_REDIRECT_URI ||
        renderEnv.GOOGLE_REDIRECT_URI ||
        "https://ai-office-worker-backend.onrender.com/api/integrations/gmail/callback",
    );
    oauth2.setCredentials({
      refresh_token: integration.refreshToken!,
      access_token: integration.accessToken ?? undefined,
    });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const fastQs = buildFastScanQueries();
    const liveLists = [];
    for (const q of fastQs) {
      const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 30 });
      const ids = (r.data.messages || []).map((m) => m.id!);
      liveLists.push({
        query: q,
        count: ids.length,
        includesRnet: ids.includes(RNET),
        includesBezeq: ids.includes(BEZEQ),
        top5: ids.slice(0, 5),
      });
    }

    // Check if old June message ids are still returned and marked processed
    const oldIds = ["19ee12f8ab9f4579", "19ed663d168fc8dc"];
    const oldEmails = await prisma.emailMessage.findMany({
      where: { organizationId: ORG, gmailId: { in: oldIds } },
      select: { gmailId: true, processedAt: true, createdAt: true, receivedAt: true },
    });

    // Integration metadata
    const integMeta = {
      id: raw?.id,
      accountEmail: (raw as any)?.accountEmail ?? (raw as any)?.email ?? null,
      status: (raw as any)?.status ?? null,
      updatedAt: raw?.updatedAt,
      hasAccess: Boolean(integration.accessToken),
      hasRefresh: Boolean(integration.refreshToken),
      expiresAt: integration.expiresAt,
      metadataKeys: raw?.metadata && typeof raw.metadata === "object" ? Object.keys(raw.metadata as object) : null,
      metadata: raw?.metadata ?? null,
    };

    // Count how many of today's attachment messages exist as EmailMessage
    const todayAttIds = [
      "19f9e3d9101ed94d",
      "19f9e3d4a3621e8d",
      "19f9e1a31eb03f30",
      "19f9e19c826d7978",
      "19f9d94e7020adb7",
      "19f9d94a517d5d86",
      "19f9d7eb3bad3371",
    ];
    const todayEmails = await prisma.emailMessage.findMany({
      where: { organizationId: ORG, gmailId: { in: todayAttIds } },
      select: { gmailId: true, processedAt: true, createdAt: true, receivedAt: true, fromAddress: true, subject: true },
    });

    const out = {
      emailsForTargets: emails,
      attachments,
      recentUnprocessed,
      liveFastLists: liveLists,
      oldEmails,
      integMeta: {
        ...integMeta,
        // strip secrets if any in metadata
        metadata:
          integMeta.metadata && typeof integMeta.metadata === "object"
            ? Object.fromEntries(
                Object.entries(integMeta.metadata as Record<string, unknown>).map(([k, v]) => [
                  k,
                  /token|secret|key/i.test(k) ? "[redacted]" : v,
                ]),
              )
            : integMeta.metadata,
      },
      todayEmails,
      summary: {
        rnetEmailMessageExists: emails.some((e) => e.gmailId === RNET),
        bezeqEmailMessageExists: emails.some((e) => e.gmailId === BEZEQ),
        rnetProcessedAt: emails.find((e) => e.gmailId === RNET)?.processedAt ?? null,
        bezeqProcessedAt: emails.find((e) => e.gmailId === BEZEQ)?.processedAt ?? null,
        fastQueryIncludesBoth: liveLists.some((l) => l.includesRnet && l.includesBezeq),
        firstQueryIncludesRnet: liveLists[0]?.includesRnet ?? false,
        firstQueryIncludesBezeq: liveLists[0]?.includesBezeq ?? false,
      },
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-emailmsg-diag.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ ...out.summary, todayEmailCount: todayEmails.length, live: liveLists.map((l) => ({ c: l.count, r: l.includesRnet, b: l.includesBezeq, q: l.query.slice(0, 60) })) }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
