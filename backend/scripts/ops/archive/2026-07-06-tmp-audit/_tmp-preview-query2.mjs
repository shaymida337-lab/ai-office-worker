import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local") });
const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const since = new Date("2026-07-06T11:34:00.000Z");

const reviews = await prisma.financialDocumentReview.findMany({
  where: { organizationId: PILOT, updatedAt: { gte: since } },
  orderBy: { updatedAt: "desc" },
  select: {
    id: true,
    source: true,
    whatsappLogId: true,
    driveFileUrl: true,
    driveUploadStatus: true,
    reviewStatus: true,
    supplierPaymentId: true,
    fileName: true,
    createdAt: true,
    updatedAt: true,
  },
});

const logId = "cmr9585l5000fii1y1pfjvfcf";
const byLog = await prisma.financialDocumentReview.findMany({ where: { whatsappLogId: logId } });

console.log(JSON.stringify({ reviews, byLog }, null, 2));
await prisma.$disconnect();
