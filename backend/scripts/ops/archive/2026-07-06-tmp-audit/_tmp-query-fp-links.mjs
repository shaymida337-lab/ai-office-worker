import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const org = "cmqxujfuj034ndy2czu9tjoko";
const fp = "f83950c2b05646c9d45ba9b6afbdb9f08e4b0f812f7d0bf4";
const gmail = "19f1c98aba4b14a0";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

const payments = await prisma.supplierPayment.findMany({
  where: { organizationId: org, documentFingerprint: fp },
  select: { id: true, approvalStatus: true, createdAt: true, emailMessageId: true },
});
const invoices = await prisma.invoice.findMany({
  where: { organizationId: org, gmailMessageId: gmail },
  select: { id: true, status: true, createdAt: true },
});
const blockedReviews = await prisma.financialDocumentReview.findMany({
  where: { organizationId: org, OR: [{ id: "cmr24980300adkg2cu1g63nz5" }, { gmailMessageId: gmail }] },
  select: { id: true, supplierPaymentId: true, uncertaintyReason: true, reviewStatus: true },
});

console.log(JSON.stringify({ payments, invoices, blockedReviews }, null, 2));
await prisma.$disconnect();
