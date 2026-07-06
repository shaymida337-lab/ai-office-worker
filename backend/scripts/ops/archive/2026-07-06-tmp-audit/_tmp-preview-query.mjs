import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local") });
const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const sid = process.argv[2] ?? "MMpreview1783337706195";

const log = await prisma.whatsAppLog.findFirst({
  where: { organizationId: PILOT, providerMessageSid: sid },
  select: { id: true, createdAt: true, mediaCount: true },
});
const recentLogs = await prisma.whatsAppLog.findMany({
  where: { organizationId: PILOT, direction: "inbound" },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { id: true, providerMessageSid: true, createdAt: true, mediaCount: true },
});
const recentReviews = await prisma.financialDocumentReview.findMany({
  where: { organizationId: PILOT, source: "whatsapp" },
  orderBy: { createdAt: "desc" },
  take: 8,
  select: {
    id: true,
    whatsappLogId: true,
    driveFileUrl: true,
    driveUploadStatus: true,
    reviewStatus: true,
    createdAt: true,
    fileName: true,
    supplierPaymentId: true,
  },
});

if (log) {
  const linked = await prisma.financialDocumentReview.findMany({
    where: { whatsappLogId: log.id },
    select: { id: true, driveFileUrl: true, reviewStatus: true, supplierPaymentId: true },
  });
  console.log(JSON.stringify({ log, linked }, null, 2));
}

console.log(JSON.stringify({ recentLogs, recentReviews }, null, 2));
await prisma.$disconnect();
