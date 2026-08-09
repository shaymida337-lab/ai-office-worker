/**
 * READ-ONLY: map kedmashopd1@gmail.com → user → org(s) → gmail integration(s)
 * and compare vs previously-used org "שי" / shaymida337.
 * Never prints tokens.
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

const LOGIN_EMAIL = "kedmashopd1@gmail.com";
const PREV_ORG = "cmpjd7j7e0001bl5tzv049rxb"; // שי / shaymida337 path used earlier
const BACKEND = "srv-d898po77f7vs73bu01v0";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
const renderKey = process.env.RENDER_API_KEY?.trim();

if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD_DATABASE_URL + ALLOW_REMOTE_READONLY_REPORT=1" }));
  process.exit(2);
}

async function loadRenderEnv() {
  if (!renderKey) return {};
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

function parseMeta(metadata) {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

async function liveMailbox(integration, clientId, clientSecret, redirectUri) {
  if (!integration?.refreshToken || !clientId || !clientSecret) {
    return { ok: false, error: "missing token or oauth client" };
  }
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({ refresh_token: integration.refreshToken });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: "me" });
    return {
      ok: true,
      emailAddress: profile.data.emailAddress ?? null,
      messagesTotal: profile.data.messagesTotal ?? null,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

async function listRecentWithAttachments(integration, clientId, clientSecret, redirectUri) {
  if (!integration?.refreshToken || !clientId || !clientSecret) {
    return { ok: false, error: "missing token/oauth", queries: [], messages: [] };
  }
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({ refresh_token: integration.refreshToken });
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const queries = [
      "newer_than:1d has:attachment",
      "newer_than:1d has:attachment -in:spam -in:trash",
      "newer_than:1d",
      "newer_than:1d in:sent has:attachment",
      "newer_than:1d filename:pdf OR filename:jpg OR filename:jpeg OR filename:png",
      "after:2026/07/25 has:attachment",
    ];
    const queryResults = [];
    for (const q of queries) {
      const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 30 });
      queryResults.push({
        query: q,
        count: (r.data.messages || []).length,
        ids: (r.data.messages || []).map((m) => m.id).filter(Boolean),
      });
    }
    const ids = [...new Set(queryResults.flatMap((r) => r.ids))].slice(0, 25);
    const messages = [];
    for (const id of ids) {
      const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const headers = Object.fromEntries(
        (full.data.payload?.headers || [])
          .filter((h) => h?.name)
          .map((h) => [String(h.name).toLowerCase(), h.value])
      );
      const atts = [];
      const walk = (p) => {
        if (!p) return;
        if (p.filename || p.body?.attachmentId) {
          atts.push({ filename: p.filename || null, mimeType: p.mimeType || null });
        }
        for (const c of p.parts || []) walk(c);
      };
      walk(full.data.payload);
      messages.push({
        id,
        receivedAt: full.data.internalDate
          ? new Date(Number(full.data.internalDate)).toISOString()
          : null,
        sender: headers.from || null,
        to: headers.to || null,
        subject: headers.subject || null,
        labelIds: full.data.labelIds || [],
        attachments: atts.filter(
          (a) =>
            a.filename ||
            (a.mimeType &&
              (a.mimeType.startsWith("image/") || a.mimeType.startsWith("application/")))
        ),
      });
    }
    messages.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    return { ok: true, queryResults, messages };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), queries: [], messages: [] };
  }
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
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { equals: LOGIN_EMAIL, mode: "insensitive" } },
          { email: { contains: "kedmashopd1", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        organization: {
          select: { id: true, name: true, businessName: true, createdAt: true },
        },
        organizationMemberships: {
          select: {
            id: true,
            role: true,
            organizationId: true,
            organization: {
              select: { id: true, name: true, businessName: true },
            },
          },
        },
      },
    });

    // Also search orgs by name/business containing kedma
    const orgsByName = await prisma.organization.findMany({
      where: {
        OR: [
          { name: { contains: "kedma", mode: "insensitive" } },
          { businessName: { contains: "kedma", mode: "insensitive" } },
          { name: { contains: "קדמה", mode: "insensitive" } },
          { businessName: { contains: "קדמה", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, businessName: true, createdAt: true },
      take: 20,
    });

    const prevOrg = await prisma.organization.findUnique({
      where: { id: PREV_ORG },
      select: {
        id: true,
        name: true,
        businessName: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });

    const orgIds = [
      ...new Set([
        ...users.flatMap((u) => [
          u.organization?.id,
          ...u.organizationMemberships.map((m) => m.organizationId),
        ]).filter(Boolean),
        ...orgsByName.map((o) => o.id),
        PREV_ORG,
      ]),
    ];

    const integrations = await prisma.integration.findMany({
      where: { organizationId: { in: orgIds }, provider: "gmail" },
      select: {
        id: true,
        organizationId: true,
        provider: true,
        accessToken: true,
        refreshToken: true,
        expiresAt: true,
        connectedAt: true,
        updatedAt: true,
        metadata: true,
      },
    });

    const orgSummaries = [];
    for (const orgId of orgIds) {
      const org =
        orgId === PREV_ORG
          ? prevOrg
          : await prisma.organization.findUnique({
              where: { id: orgId },
              select: {
                id: true,
                name: true,
                businessName: true,
                user: { select: { id: true, email: true, name: true } },
              },
            });
      const rawInt = integrations.find((i) => i.organizationId === orgId) ?? null;
      const decrypted = rawInt ? decryptIntegrationTokens(rawInt) : null;
      const meta = parseMeta(rawInt?.metadata);
      const live = decrypted
        ? await liveMailbox(decrypted, clientId, clientSecret, redirectUri)
        : { ok: false, error: "no gmail integration" };

      const since = new Date(Date.now() - 6 * 3600e3);
      const [syncLogs, fdrCount, gsiCount] = await Promise.all([
        prisma.syncLog.findMany({
          where: { organizationId: orgId, type: "gmail_scan", startedAt: { gte: since } },
          orderBy: { startedAt: "desc" },
          take: 8,
          select: {
            id: true,
            status: true,
            scanMode: true,
            emailsProcessed: true,
            emailsSaved: true,
            totalMatched: true,
            invoicesFound: true,
            errorMessage: true,
            startedAt: true,
            finishedAt: true,
          },
        }),
        prisma.financialDocumentReview.count({
          where: { organizationId: orgId, createdAt: { gte: since } },
        }),
        prisma.gmailScanItem.count({
          where: { organizationId: orgId, createdAt: { gte: since } },
        }),
      ]);

      let mailboxProbe = null;
      if (live.ok && decrypted) {
        mailboxProbe = await listRecentWithAttachments(
          decrypted,
          clientId,
          clientSecret,
          redirectUri
        );
      }

      orgSummaries.push({
        organizationId: orgId,
        organizationName: org?.name ?? null,
        businessName: org?.businessName ?? null,
        ownerUser: org?.user ?? null,
        gmailIntegration: rawInt
          ? {
              id: rawInt.id,
              connectedAt: rawInt.connectedAt,
              updatedAt: rawInt.updatedAt,
              expiresAt: rawInt.expiresAt,
              hasRefreshToken: Boolean(decrypted?.refreshToken),
              metadataGoogleAccountEmail:
                typeof meta.googleAccountEmail === "string"
                  ? meta.googleAccountEmail
                  : meta.email ?? null,
            }
          : null,
        liveMailbox: live,
        recentScanActivity6h: {
          syncLogs: syncLogs.map((s) => ({
            ...s,
            startedAt: s.startedAt?.toISOString?.() ?? s.startedAt,
            finishedAt: s.finishedAt?.toISOString?.() ?? s.finishedAt,
          })),
          fdrCreated: fdrCount,
          gsiCreated: gsiCount,
        },
        mailboxProbe: mailboxProbe
          ? {
              ok: mailboxProbe.ok,
              error: mailboxProbe.error ?? null,
              queryResults: (mailboxProbe.queryResults || []).map((r) => ({
                query: r.query,
                count: r.count,
                sampleIds: (r.ids || []).slice(0, 5),
              })),
              recentMessages: (mailboxProbe.messages || [])
                .filter(
                  (m) =>
                    (m.attachments || []).length > 0 ||
                    (m.receivedAt &&
                      Date.now() - new Date(m.receivedAt).getTime() < 6 * 3600e3)
                )
                .slice(0, 15)
                .map((m) => ({
                  id: m.id,
                  receivedAt: m.receivedAt,
                  sender: m.sender,
                  to: m.to,
                  subject: m.subject,
                  attachments: (m.attachments || [])
                    .map((a) => a.filename)
                    .filter(Boolean),
                  labelIds: m.labelIds,
                })),
            }
          : null,
      });
    }

    // Any integration metadata pointing at kedmashopd1 across ALL orgs
    const allGmail = await prisma.integration.findMany({
      where: { provider: "gmail" },
      select: {
        id: true,
        organizationId: true,
        metadata: true,
        connectedAt: true,
        updatedAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            businessName: true,
            user: { select: { email: true, name: true } },
          },
        },
      },
      take: 200,
    });
    const metaHits = allGmail
      .map((i) => ({ i, meta: parseMeta(i.metadata) }))
      .filter(({ meta, i }) => {
        const blob = JSON.stringify(meta).toLowerCase();
        return (
          blob.includes("kedmashopd1") ||
          i.organization?.user?.email?.toLowerCase() === LOGIN_EMAIL
        );
      })
      .map(({ i, meta }) => ({
        organizationId: i.organizationId,
        organizationName: i.organization?.name,
        businessName: i.organization?.businessName,
        ownerEmail: i.organization?.user?.email,
        metadataGoogleAccountEmail: meta.googleAccountEmail ?? meta.email ?? null,
        connectedAt: i.connectedAt,
        updatedAt: i.updatedAt,
      }));

    const out = {
      now: new Date().toISOString(),
      loginEmailQueried: LOGIN_EMAIL,
      whyPreviousOrgWasChecked:
        "Default VERIFY_ORG_ID / scripts historically used cmpjd7j7e0001bl5tzv049rxb (שי / shaymida337) as the primary prod org for Shay — not derived from kedmashopd1 login.",
      usersMatchingLogin: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        ownedOrganizationId: u.organization?.id ?? null,
        ownedOrganizationName: u.organization?.name ?? null,
        ownedBusinessName: u.organization?.businessName ?? null,
        memberships: u.organizationMemberships.map((m) => ({
          organizationId: m.organizationId,
          role: m.role,
          organizationName: m.organization?.name ?? null,
          businessName: m.organization?.businessName ?? null,
        })),
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })),
      orgsByNameSearch: orgsByName,
      previousOrgUsedInPriorDiagnosis: prevOrg,
      orgSummaries,
      gmailMetadataHitsForKedma: metaHits,
    };

    writeFileSync(
      join(process.cwd(), "_tmp-kedma-org-gmail-mismatch.json"),
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
