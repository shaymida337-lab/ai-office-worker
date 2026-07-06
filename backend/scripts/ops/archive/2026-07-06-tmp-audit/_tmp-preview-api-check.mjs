import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

config({ path: join(process.cwd(), ".env.prod.local") });
const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const REVIEW_ID = "cmr939iyn00ffk21sisb5sd0n";
const apiBase = "https://ai-office-worker-backend.onrender.com";

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

const renderEnv = await fetchRenderEnvMap();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const org = await prisma.organization.findUnique({ where: { id: PILOT }, include: { user: true } });
const token = jwt.sign({ userId: org.user.id, organizationId: PILOT, email: org.user.email }, renderEnv.JWT_SECRET, { expiresIn: "1h" });

const review = await prisma.financialDocumentReview.findUnique({
  where: { id: REVIEW_ID },
  select: {
    id: true,
    source: true,
    whatsappLogId: true,
    driveFileUrl: true,
    driveUploadStatus: true,
    reviewStatus: true,
    supplierPaymentId: true,
    fileName: true,
    updatedAt: true,
  },
});

const apiReviews = await fetch(`${apiBase}/api/document-reviews`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then((r) => r.json());

const apiRow = Array.isArray(apiReviews) ? apiReviews.find((r) => r.id === REVIEW_ID) : null;

const nullLegacy = await prisma.financialDocumentReview.count({
  where: {
    organizationId: PILOT,
    source: "whatsapp",
    createdAt: { lt: new Date("2026-07-06T11:34:00.000Z") },
    OR: [{ driveFileUrl: null }, { driveFileUrl: "" }],
  },
});

const gmailSample = await prisma.financialDocumentReview.findFirst({
  where: { organizationId: PILOT, source: "gmail", driveFileUrl: { not: null } },
  select: { id: true, driveFileUrl: true },
});

console.log(
  JSON.stringify(
    {
      review,
      apiRow: apiRow
        ? { id: apiRow.id, driveFileUrl: apiRow.driveFileUrl, reviewStatus: apiRow.reviewStatus }
        : null,
      legacyNullPreviewsUnchanged: nullLegacy,
      gmailSample,
      previewUrlType: review?.driveFileUrl?.includes("drive.google.com")
        ? "drive"
        : review?.driveFileUrl?.startsWith("/uploads/")
          ? "local_upload"
          : "none",
      uiPreviewIframeSrc: review?.driveFileUrl?.match(/\/d\/([a-zA-Z0-9_-]+)/)
        ? `https://drive.google.com/file/d/${review.driveFileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)[1]}/preview`
        : review?.driveFileUrl,
      paymentGated: !review?.supplierPaymentId && review?.reviewStatus === "needs_review",
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
