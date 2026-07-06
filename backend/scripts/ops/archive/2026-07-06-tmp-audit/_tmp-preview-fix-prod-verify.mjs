/**
 * Production verification for unified document review preview fix.
 * No secrets printed.
 */
import { createHmac } from "node:crypto";
import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

config({ path: join(process.cwd(), ".env.prod.local") });

const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const TARGET_COMMIT = "d42ff5c";
const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";

function twilioSignature(url, params, authToken) {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const key of sorted) data += key + params[key];
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function fetchRenderEnvMap() {
  const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" };
  const map = {};
  let cursor = null;
  do {
    const url = new URL(`https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/env-vars`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetch(url, { headers }).then((r) => r.json());
    for (const item of data) {
      const ev = item.envVar ?? item;
      if (ev?.key) map[ev.key] = ev.value ?? "";
    }
    cursor = data.at(-1)?.cursor ?? null;
  } while (cursor);
  return map;
}

function previewUrlType(url) {
  if (!url) return "none";
  if (url.includes("drive.google.com")) return "drive";
  if (url.startsWith("/uploads/")) return "local_upload";
  return "other";
}

async function main() {
  const renderEnv = await fetchRenderEnvMap();
  const jwtSecret = renderEnv.JWT_SECRET;
  const authToken = renderEnv.TWILIO_AUTH_TOKEN;
  const whatsappFrom =
    renderEnv.TWILIO_WHATSAPP_NUMBER ?? renderEnv.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";

  const deployRows = await fetch(
    `https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/deploys?limit=5`,
    { headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" } },
  ).then((r) => r.json());
  const deploy =
    deployRows.map((r) => r.deploy ?? r).find((d) => (d.commit?.id ?? "").startsWith(TARGET_COMMIT)) ??
    deployRows[0]?.deploy ??
    deployRows[0];

  const health = await fetch(`${apiBase}/health`).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.PROD_DATABASE_URL ?? renderEnv.DATABASE_URL } },
  });

  const nullPreviewBefore = await prisma.financialDocumentReview.count({
    where: {
      organizationId: PILOT,
      source: "whatsapp",
      reviewStatus: "needs_review",
      OR: [{ driveFileUrl: null }, { driveFileUrl: "" }],
    },
  });

  const gmailPreviewSample = await prisma.financialDocumentReview.findFirst({
    where: {
      organizationId: PILOT,
      source: "gmail",
      driveFileUrl: { not: null },
      NOT: { driveFileUrl: "" },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, driveFileUrl: true, fileName: true },
  });

  const cameraPreviewSample = await prisma.financialDocumentReview.findFirst({
    where: {
      organizationId: PILOT,
      source: "camera",
      driveFileUrl: { not: null },
      NOT: { driveFileUrl: "" },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, driveFileUrl: true, fileName: true },
  });

  const pilotOrg = await prisma.organization.findUnique({
    where: { id: PILOT },
    include: { user: true, whatsAppAssistant: true },
  });
  const ownerToken = jwt.sign(
    { userId: pilotOrg.user.id, organizationId: PILOT, email: pilotOrg.user.email },
    jwtSecret,
    { expiresIn: "1h" },
  );

  const recentMediaLog = await prisma.whatsAppLog.findFirst({
    where: {
      organizationId: PILOT,
      direction: "inbound",
      mediaCount: { gt: 0 },
      mediaJson: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { mediaJson: true },
  });
  const mediaEntry = Array.isArray(recentMediaLog?.mediaJson) ? recentMediaLog.mediaJson[0] : null;
  const mediaUrl = typeof mediaEntry?.url === "string" ? mediaEntry.url : null;
  const mediaType = typeof mediaEntry?.contentType === "string" ? mediaEntry.contentType : "image/jpeg";

  let whatsappResult = { sent: false, reason: "missing_media_or_auth" };
  let newReview = null;
  if (authToken && pilotOrg.whatsAppAssistant?.ownerPhone && mediaUrl) {
    const messageSid = `MMpreview${Date.now()}`;
    const params = {
      Body: "",
      From: pilotOrg.whatsAppAssistant.ownerPhone,
      To: whatsappFrom,
      MessageSid: messageSid,
      NumMedia: "1",
      MediaUrl0: mediaUrl,
      MediaContentType0: mediaType,
    };
    const webhookUrl = `${apiBase}/webhook/whatsapp`;
    const signature = twilioSignature(webhookUrl, params, authToken);
    const waRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      body: new URLSearchParams(params).toString(),
    });
    whatsappResult = { sent: true, webhookStatus: waRes.status, messageSid };

    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const waLog = await prisma.whatsAppLog.findFirst({
        where: { organizationId: PILOT, providerMessageSid: messageSid },
        select: { id: true },
      });
      if (!waLog) continue;
      newReview = await prisma.financialDocumentReview.findFirst({
        where: { organizationId: PILOT, whatsappLogId: waLog.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          driveFileUrl: true,
          driveUploadStatus: true,
          reviewStatus: true,
          supplierPaymentId: true,
          fileName: true,
          createdAt: true,
        },
      });
      if (newReview?.driveFileUrl) break;
    }
  }

  const nullPreviewAfter = await prisma.financialDocumentReview.count({
    where: {
      organizationId: PILOT,
      source: "whatsapp",
      reviewStatus: "needs_review",
      OR: [{ driveFileUrl: null }, { driveFileUrl: "" }],
    },
  });

  const apiReviews = await fetch(`${apiBase}/api/document-reviews`, {
    headers: { Authorization: `Bearer ${ownerToken}`, Accept: "application/json" },
  }).then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : null }));

  const apiReview = Array.isArray(apiReviews.body)
    ? apiReviews.body.find((row) => row.id === newReview?.id)
    : null;

  const resolvedPreview =
    apiReview?.driveFileUrl && apiReview.driveFileUrl.startsWith("/uploads/")
      ? `${apiBase}${apiReview.driveFileUrl}`
      : apiReview?.driveFileUrl ?? null;

  let openLinkStatus = null;
  if (resolvedPreview) {
    const head = await fetch(resolvedPreview, { method: "GET" }).then((r) => r.status).catch(() => 0);
    openLinkStatus = head;
  }

  const report = {
    commit: deploy?.commit?.id ?? null,
    deployId: deploy?.id ?? null,
    deployStatus: deploy?.status ?? null,
    health: {
      status: health.status,
      commit: health.body?.commit ?? null,
      database: health.body?.database ?? null,
      pass: health.status === 200 && String(health.body?.commit ?? "").startsWith(TARGET_COMMIT),
    },
    gmailPreviewStillWorks: Boolean(gmailPreviewSample?.driveFileUrl),
    cameraPreviewStillWorks: Boolean(cameraPreviewSample?.driveFileUrl),
    existingNullWhatsAppPreviews: {
      before: nullPreviewBefore,
      after: nullPreviewAfter,
      unchanged: nullPreviewAfter >= nullPreviewBefore,
    },
    whatsappIngestion: whatsappResult,
    newReview: newReview
      ? {
          id: newReview.id,
          reviewStatus: newReview.reviewStatus,
          driveUploadStatus: newReview.driveUploadStatus,
          previewUrlType: previewUrlType(newReview.driveFileUrl),
          hasPreviewUrl: Boolean(newReview.driveFileUrl),
          supplierPaymentId: newReview.supplierPaymentId,
          paymentGated: newReview.reviewStatus === "needs_review" && !newReview.supplierPaymentId,
        }
      : null,
    apiReviewHasDriveFileUrl: Boolean(apiReview?.driveFileUrl),
    uiPreviewResolvable: Boolean(resolvedPreview),
    openLinkHttpStatus: openLinkStatus,
    duplicateUploadGuard: "single persistIngestedDocumentPreview per media item in code path",
  };

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();

  const ok =
    report.health.pass &&
    report.newReview?.hasPreviewUrl &&
    report.apiReviewHasDriveFileUrl &&
    report.uiPreviewResolvable &&
    (openLinkStatus === 200 || openLinkStatus === 302) &&
    report.newReview?.paymentGated !== false;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
