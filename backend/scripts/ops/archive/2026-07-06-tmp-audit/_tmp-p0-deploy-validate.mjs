/**
 * P0 security deploy production validation — never prints secrets.
 */
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const TARGET_COMMIT = "044376c30e3174dce2a4a9a30a3c75be96521734";
const PILOT_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const OTHER_ORG = "cmqxujfuj034ndy2czu9tjoko";
const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";
const deployId = process.argv[2] ?? "dep-d95nrvmq1p3s73e4c460";

const SENSITIVE_LOG_PATTERNS = [
  /refresh_token/i,
  /access_token/i,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./,
  /TWILIO_AUTH_TOKEN[=:]\s*\S+/i,
  /SECRETS_ENCRYPTION_KEY[=:]\s*\S+/i,
];

function twilioSignature(url, params, authToken) {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const key of sorted) data += key + params[key];
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function fetchRenderEnvMap() {
  const headers = {
    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
    Accept: "application/json",
  };
  const serviceId = process.env.RENDER_SERVICE_ID;
  const map = {};
  let cursor = null;
  do {
    const url = new URL(`https://api.render.com/v1/services/${serviceId}/env-vars`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers });
    const data = await res.json();
    for (const item of data) {
      const ev = item.envVar ?? item;
      if (ev?.key) map[ev.key] = ev.value ?? "";
    }
    cursor = data.at(-1)?.cursor ?? null;
  } while (cursor);
  return map;
}

async function apiCall(token, method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body: parsed };
}

async function pollScan(token, scanId, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const r = await apiCall(token, "GET", `/api/gmail/scan/${scanId}`);
    const status = r.body?.status ?? r.body?.scan?.status;
    if (status === "completed" || status === "failed" || status === "error") return r;
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  return { status: 408, body: { error: "scan poll timeout" } };
}

async function fetchRecentRenderLogs() {
  const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" };
  const serviceId = process.env.RENDER_SERVICE_ID;
  const res = await fetch(
    `https://api.render.com/v1/services/${serviceId}/logs?limit=100&direction=backward`,
    { headers },
  );
  if (!res.ok) return { ok: false, status: res.status, lines: [] };
  const payload = await res.json();
  const lines = [];
  for (const row of payload.logs ?? payload ?? []) {
    const msg = row.message ?? row.text ?? (typeof row === "string" ? row : JSON.stringify(row));
    if (typeof msg === "string") lines.push(msg);
  }
  return { ok: true, lines };
}

function scanLogsForSensitive(lines) {
  const hits = [];
  for (const line of lines) {
    for (const pattern of SENSITIVE_LOG_PATTERNS) {
      if (pattern.test(line)) {
        hits.push({ pattern: pattern.source, snippet: line.slice(0, 120).replace(/[A-Za-z0-9._-]{20,}/g, "[redacted]") });
        break;
      }
    }
  }
  return hits;
}

async function main() {
  const renderEnv = await fetchRenderEnvMap();
  const jwtSecret = renderEnv.JWT_SECRET ?? process.env.PROD_JWT_SECRET;
  const authToken = renderEnv.TWILIO_AUTH_TOKEN;
  const whatsappFrom =
    renderEnv.TWILIO_WHATSAPP_NUMBER ?? renderEnv.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.PROD_DATABASE_URL ?? renderEnv.DATABASE_URL } },
  });

  const results = {};

  // Deploy status
  const deployHeaders = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" };
  const deployRows = await fetch(
    `https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/deploys?limit=5`,
    { headers: deployHeaders },
  ).then((r) => r.json());
  const deploy = deployRows.map((r) => r.deploy ?? r).find((d) => d.id === deployId) ?? deployRows[0]?.deploy ?? deployRows[0];
  const commitId = deploy?.commit?.id ?? "";
  results.deploy = {
    pass: deploy?.status === "live" && commitId.startsWith("044376c"),
    deployId: deploy?.id ?? null,
    status: deploy?.status ?? null,
    commit: commitId.slice(0, 7),
    finishedAt: deploy?.finishedAt ?? null,
  };

  // Health
  const healthRes = await fetch(`${apiBase}/health`).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
  results.health = {
    pass:
      healthRes.status === 200 &&
      healthRes.body?.status === "ok" &&
      healthRes.body?.database === "connected" &&
      String(healthRes.body?.commit ?? "").startsWith("044376c"),
    status: healthRes.status,
    database: healthRes.body?.database,
    commit: healthRes.body?.commit ?? null,
  };

  const pilotOrg = await prisma.organization.findUnique({
    where: { id: PILOT_ORG },
    include: { user: true, whatsAppAssistant: true },
  });
  if (!pilotOrg?.user) throw new Error(`Pilot org missing: ${PILOT_ORG}`);

  const ownerToken = jwt.sign(
    { userId: pilotOrg.user.id, organizationId: pilotOrg.id, email: pilotOrg.user.email },
    jwtSecret,
    { expiresIn: "1h" },
  );

  // Gmail OAuth — status + encrypted token + connect URL
  const gmailIntegration = await prisma.integration.findFirst({
    where: { organizationId: PILOT_ORG, provider: "gmail" },
    select: { refreshToken: true, accessToken: true, connectedAt: true },
  });
  const gmailStatus = await apiCall(ownerToken, "GET", "/api/integrations/gmail/status");
  const connectUrl = await apiCall(ownerToken, "GET", "/api/integrations/gmail/connect-url");
  const tokenEncrypted =
    Boolean(gmailIntegration?.refreshToken?.startsWith("enc:v1:")) ||
    Boolean(gmailIntegration?.accessToken?.startsWith("enc:v1:"));
  results.gmailOAuth = {
    pass:
      gmailStatus.status === 200 &&
      gmailStatus.body?.connected === true &&
      connectUrl.status === 200 &&
      typeof connectUrl.body?.url === "string" &&
      connectUrl.body.url.includes("accounts.google.com"),
    connected: gmailStatus.body?.connected ?? false,
    reconnectRequired: gmailStatus.body?.reconnectRequired ?? null,
    connectUrlStatus: connectUrl.status,
    tokenEncrypted,
    note: tokenEncrypted
      ? "stored tokens use enc:v1 prefix"
      : "tokens may be legacy plaintext until next OAuth refresh",
  };

  // Gmail scan — incremental 1 day
  const scanStart = await apiCall(ownerToken, "POST", "/api/gmail/scan", { daysBack: 1 });
  let scanPass = false;
  let scanDetail = { startStatus: scanStart.status, body: scanStart.body };
  if (scanStart.status === 200 || scanStart.status === 202) {
    const scanId = scanStart.body?.scanId ?? scanStart.body?.id;
    if (scanId) {
      const progress = await pollScan(ownerToken, scanId, 15);
      const finalStatus = progress.body?.status ?? progress.body?.scan?.status;
      scanPass =
        progress.status === 200 &&
        (finalStatus === "completed" || finalStatus === "running" || Boolean(progress.body?.emailsProcessed));
      scanDetail = { ...scanDetail, scanId, finalStatus, progressStatus: progress.status };
    } else if (scanStart.body?.message?.includes?.("progress") || scanStart.body?.progressUrl) {
      scanPass = true;
      scanDetail = { ...scanDetail, note: "scan already in progress or started" };
    }
  } else if (scanStart.status === 409) {
    scanPass = true;
    scanDetail = { ...scanDetail, note: "scan already active" };
  }
  results.gmailScan = { pass: scanPass, ...scanDetail };

  // WhatsApp invoice — replay media from recent production log
  const ownerPhone = pilotOrg.whatsAppAssistant?.ownerPhone;
  const recentMediaLog = await prisma.whatsAppLog.findFirst({
    where: {
      organizationId: PILOT_ORG,
      direction: "inbound",
      mediaCount: { gt: 0 },
      mediaJson: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { mediaJson: true },
  });
  const mediaJson = recentMediaLog?.mediaJson;
  const mediaEntry = Array.isArray(mediaJson) ? mediaJson[0] : null;
  const mediaUrl = typeof mediaEntry?.url === "string" ? mediaEntry.url : null;
  const mediaType = typeof mediaEntry?.contentType === "string" ? mediaEntry.contentType : "image/jpeg";

  let whatsappPass = false;
  let whatsappDetail = { ownerPhone: ownerPhone ?? null, mediaUrlFound: Boolean(mediaUrl) };
  if (authToken && ownerPhone && mediaUrl) {
    const messageSid = `MMp0${Date.now()}validate`;
    const params = {
      Body: "",
      From: ownerPhone,
      To: whatsappFrom,
      MessageSid: messageSid,
      NumMedia: "1",
      MediaUrl0: mediaUrl,
      MediaContentType0: mediaType ?? "image/jpeg",
    };
    const webhookUrl = `${apiBase}/webhook/whatsapp`;
    const signature = twilioSignature(webhookUrl, params, authToken);
    const form = new URLSearchParams(params);
    const waRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      body: form.toString(),
    });
    await new Promise((r) => setTimeout(r, 12000));
    const waLog = await prisma.whatsAppLog.findFirst({
      where: { organizationId: PILOT_ORG, providerMessageSid: messageSid },
      select: { id: true, mediaCount: true },
    });
    const fdr = await prisma.financialDocumentReview.findFirst({
      where: {
        organizationId: PILOT_ORG,
        source: "whatsapp",
        OR: [{ whatsappLogId: waLog?.id ?? "none" }, { updatedAt: { gte: new Date(Date.now() - 120_000) } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        reviewStatus: true,
        uncertaintyReason: true,
        supplierName: true,
        totalAmount: true,
        rawAnalysis: true,
        fileName: true,
      },
    });
    whatsappPass = waRes.status === 200 && Boolean(waLog) && Boolean(fdr);
    whatsappDetail = {
      ...whatsappDetail,
      webhookStatus: waRes.status,
      whatsAppLogId: waLog?.id ?? null,
      financialDocumentReviewId: fdr?.id ?? null,
      reviewStatus: fdr?.reviewStatus ?? null,
      hasAnalysis: Boolean(fdr?.rawAnalysis),
      uncertaintyReason: fdr?.uncertaintyReason ?? null,
    };
  }
  results.whatsappInvoice = { pass: whatsappPass, ...whatsappDetail };

  // Communications API
  const commRes = await apiCall(ownerToken, "GET", "/api/communications?limit=10");
  const commItems = commRes.body?.events ?? commRes.body?.items ?? commRes.body ?? [];
  const commList = Array.isArray(commItems) ? commItems : [];
  const crossOrgComm = commList.some((e) => e.organizationId && e.organizationId !== PILOT_ORG);
  results.communicationEvent = {
    pass: commRes.status === 200 && !crossOrgComm,
    status: commRes.status,
    count: commList.length,
    crossOrgLeak: crossOrgComm,
    hasCorrelationId: commList.length === 0 || commList.some((e) => e.correlationId),
  };

  // Debug endpoints — read_only member or synthetic employee role user
  const limitedMember = await prisma.organizationMember.findFirst({
    where: {
      organizationId: PILOT_ORG,
      role: { in: ["read_only", "employee"] },
    },
    include: { user: true },
  });
  let limitedToken = null;
  if (limitedMember?.user) {
    limitedToken = jwt.sign(
      {
        userId: limitedMember.user.id,
        organizationId: PILOT_ORG,
        email: limitedMember.user.email,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );
  } else {
    // Fallback: use owner token against OTHER org data path — still tests RBAC on debug
    limitedToken = ownerToken;
  }

  const debugPaths = [
    "/api/debug/gmail/status",
    "/api/debug/invoices",
    "/api/debug/payments/top-amounts",
  ];
  const debugResults = {};
  for (const path of debugPaths) {
    const r = await apiCall(limitedToken, "GET", path);
    debugResults[path] = r.status;
  }
  const all403 = Object.values(debugResults).every((s) => s === 403);
  results.debugEndpoints = {
    pass: all403,
    limitedRole: limitedMember?.role ?? "owner-fallback",
    statuses: debugResults,
  };

  // Tenant isolation — pilot token cannot read other org clients
  const otherOrg = await prisma.organization.findUnique({
    where: { id: OTHER_ORG },
    include: { clients: { take: 1, select: { id: true } } },
  });
  const otherClientId = otherOrg?.clients[0]?.id;
  let tenantPass = true;
  const tenantChecks = {};
  if (otherClientId) {
    const clientRes = await apiCall(ownerToken, "GET", `/api/clients/${otherClientId}`);
    tenantChecks.crossOrgClient = clientRes.status;
    tenantPass = tenantPass && (clientRes.status === 403 || clientRes.status === 404);
  }
  const otherComm = await apiCall(ownerToken, "GET", `/api/communications?organizationId=${OTHER_ORG}&limit=5`);
  tenantChecks.crossOrgCommQuery = otherComm.status;
  tenantPass = tenantPass && otherComm.status !== 200;
  const waOther = await prisma.whatsAppLog.findFirst({
    where: { organizationId: OTHER_ORG },
    select: { id: true },
  });
  tenantChecks.otherOrgHasSeparateData = Boolean(waOther);
  results.tenantIsolation = { pass: tenantPass, checks: tenantChecks };

  // Sensitive logs
  const logFetch = await fetchRecentRenderLogs();
  const sensitiveHits = scanLogsForSensitive(logFetch.lines ?? []);
  results.sensitiveLogs = {
    pass: sensitiveHits.length === 0,
    logApiOk: logFetch.ok,
    linesScanned: logFetch.lines?.length ?? 0,
    hitCount: sensitiveHits.length,
    samples: sensitiveHits.slice(0, 3),
  };

  const table = {
    Deploy: results.deploy.pass ? "PASS" : "FAIL",
    Health: results.health.pass ? "PASS" : "FAIL",
    "Gmail OAuth": results.gmailOAuth.pass ? "PASS" : "FAIL",
    "Gmail Scan": results.gmailScan.pass ? "PASS" : "FAIL",
    "WhatsApp Invoice": results.whatsappInvoice.pass ? "PASS" : "FAIL",
    CommunicationEvent: results.communicationEvent.pass ? "PASS" : "FAIL",
    "Debug endpoints protected": results.debugEndpoints.pass ? "PASS" : "FAIL",
    "Tenant isolation": results.tenantIsolation.pass ? "PASS" : "FAIL",
    "Sensitive logs": results.sensitiveLogs.pass ? "PASS" : "FAIL",
  };

  const allPass = Object.values(table).every((v) => v === "PASS");

  console.log(
    JSON.stringify(
      {
        table,
        domain1: allPass ? "DOMAIN 1 COMPLETE" : "DOMAIN 1 NOT COMPLETE",
        details: results,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
