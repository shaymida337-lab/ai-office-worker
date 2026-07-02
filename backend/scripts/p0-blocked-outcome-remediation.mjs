/**
 * Remediate blocked_outcome_persisted rows: unlink/reject payments linked to BLOCKED reviews.
 * Usage: node scripts/p0-blocked-outcome-remediation.mjs [--execute]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const execute = process.argv.includes("--execute");
const organizationId = process.argv.find((a) => !a.startsWith("-") && !a.endsWith(".mjs") && a !== "node") ?? null;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

function isBlockedReview(row) {
  const parsed = row.parsedFieldsJson;
  const status =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed.outcome?.status
      : null;
  if (typeof status === "string" && status.toUpperCase() === "BLOCKED") return true;
  const uncertainty = (row.uncertaintyReason ?? "").toLowerCase();
  if (uncertainty.includes("outcome_blocked") || uncertainty.includes("oe_trust_blocked")) return true;
  if (row.supplierPaymentId) {
    const bucket =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? String((parsed as { outcome?: { status?: string } }).outcome?.status ?? "").toUpperCase()
        : "";
    if (bucket === "BLOCKED") return true;
  }
  return false;
}

async function main() {
  const reviews = await prisma.financialDocumentReview.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      OR: [{ supplierPaymentId: { not: null } }, { documentFingerprint: { not: null } }],
    },
    select: {
      id: true,
      organizationId: true,
      supplierPaymentId: true,
      documentFingerprint: true,
      gmailMessageId: true,
      parsedFieldsJson: true,
      uncertaintyReason: true,
    },
  });

  const blocked = reviews.filter(isBlockedReview);
  const actions = [];

  for (const review of blocked) {
    if (review.supplierPaymentId) {
      actions.push({
        type: "unlink_payment",
        reviewId: review.id,
        paymentId: review.supplierPaymentId,
      });
    }
    if (review.documentFingerprint) {
      const payments = await prisma.supplierPayment.findMany({
        where: {
          organizationId: review.organizationId,
          documentFingerprint: review.documentFingerprint,
          approvalStatus: { not: "rejected" },
        },
        select: { id: true, approvalStatus: true },
      });
      for (const payment of payments) {
        actions.push({
          type: "reject_payment",
          reviewId: review.id,
          paymentId: payment.id,
          previousStatus: payment.approvalStatus,
        });
      }
    }
  }

  console.log(JSON.stringify({ execute, blockedReviews: blocked.length, actions }, null, 2));

  if (!execute) {
    console.log("Dry run only. Re-run with --execute to apply.");
    return;
  }

  for (const action of actions) {
    if (action.type === "unlink_payment") {
      await prisma.financialDocumentReview.update({
        where: { id: action.reviewId },
        data: { supplierPaymentId: null },
      });
    }
    if (action.type === "reject_payment") {
      await prisma.supplierPayment.update({
        where: { id: action.paymentId },
        data: {
          approvalStatus: "rejected",
          duplicateDetected: true,
          notes: "P0 remediation: blocked_outcome_persisted",
        },
      });
    }
  }

  console.log("Remediation applied.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
