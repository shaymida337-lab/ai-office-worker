import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
config({ path: join(process.cwd(), ".env.prod.local") });
const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const p = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const r = await p.$queryRawUnsafe(
  `SELECT
    (SELECT COUNT(*)::int FROM "GmailScanItem" gsi INNER JOIN (
      SELECT "gmailMessageId" FROM "GmailScanItem" WHERE "gmailMessageId" IS NOT NULL AND "gmailMessageId"<>'' GROUP BY "gmailMessageId" HAVING COUNT(DISTINCT "organizationId")>1
    ) c ON c."gmailMessageId"=gsi."gmailMessageId" WHERE gsi."organizationId"=$1) AS pilot_cross_org_gsi,
    (SELECT COUNT(*)::int FROM "FinancialDocumentReview" WHERE "organizationId"=$1 AND "reviewStatus"='needs_review' AND "supplierPaymentId" IS NOT NULL) AS pilot_needs_review_with_payment,
    (SELECT COUNT(*)::int FROM "SupplierPayment" WHERE "organizationId"=$1 AND amount=0) AS pilot_zero_payments,
    (SELECT COUNT(*)::int FROM "FinancialDocumentReview" WHERE "organizationId"=$1 AND source='whatsapp') AS pilot_whatsapp_fdr,
    (SELECT COUNT(*)::int FROM "FinancialDocumentReview" WHERE "organizationId"=$1 AND source='gmail') AS pilot_gmail_fdr`,
  PILOT,
);
console.log(JSON.stringify(r[0], null, 2));
await p.$disconnect();
