import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const execute = process.argv.includes("--execute");
const reviewIds = ["cmr24980300adkg2cu1g63nz5", "cmr1wetwb000fg82cl5onpqbi"];

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

const reviews = await prisma.financialDocumentReview.findMany({
  where: { id: { in: reviewIds } },
  select: {
    id: true,
    organizationId: true,
    supplierPaymentId: true,
    documentFingerprint: true,
    uncertaintyReason: true,
    parsedFieldsJson: true,
  },
});

const actions = [];
for (const review of reviews) {
  if (review.supplierPaymentId) {
    actions.push({ type: "unlink", reviewId: review.id, paymentId: review.supplierPaymentId });
  }
  if (review.documentFingerprint) {
    const payments = await prisma.supplierPayment.findMany({
      where: {
        organizationId: review.organizationId,
        documentFingerprint: review.documentFingerprint,
        approvalStatus: { not: "rejected" },
      },
      select: { id: true },
    });
    for (const p of payments) actions.push({ type: "reject", paymentId: p.id, reviewId: review.id });
  }
}

console.log(JSON.stringify({ reviews, actions, execute }, null, 2));

if (execute) {
  for (const action of actions) {
    if (action.type === "unlink") {
      await prisma.financialDocumentReview.update({
        where: { id: action.reviewId },
        data: { supplierPaymentId: null },
      });
    }
    if (action.type === "reject") {
      await prisma.supplierPayment.update({
        where: { id: action.paymentId },
        data: {
          approvalStatus: "rejected",
          duplicateDetected: true,
          notes: "P0-3.3: blocked_outcome_persisted remediation",
        },
      });
    }
  }
  console.log("Applied.");
}

await prisma.$disconnect();
