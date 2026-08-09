/**
 * READ-ONLY: find ANY second source for tire 450 / pharm 918 cards
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") process.exit(2);

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

const AMOUNTS = [450, 918];
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function main() {
  const [fdrs, gsis, invoices, payments, emailMsgs] = await Promise.all([
    prisma.financialDocumentReview.findMany({
      where: { organizationId: ORG, createdAt: { gte: since }, totalAmount: { in: AMOUNTS } },
    }),
    prisma.gmailScanItem.findMany({
      where: { organizationId: ORG, createdAt: { gte: since }, amount: { in: AMOUNTS } },
    }),
    prisma.invoice.findMany({
      where: { organizationId: ORG, createdAt: { gte: since }, amount: { in: AMOUNTS } },
      select: { id: true, amount: true, supplierName: true, gmailMessageId: true, emailId: true, createdAt: true, status: true },
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId: ORG, createdAt: { gte: since }, amount: { in: AMOUNTS } },
    }),
    prisma.emailMessage.findMany({
      where: {
        organizationId: ORG,
        gmailId: { in: ["19f9e1a31eb03f30", "19f9e19c826d7978"] },
      },
    }),
  ]);

  // All sources by amount
  const byAmount: Record<string, any> = {};
  for (const amount of AMOUNTS) {
    byAmount[String(amount)] = {
      fdr: fdrs.filter((r) => Number(r.totalAmount) === amount).map((r) => ({
        table: "FDR",
        id: r.id,
        supplier: r.supplierName,
        amount: r.totalAmount,
        gmail: r.gmailMessageId,
        email: r.emailMessageId,
        file: r.fileName,
        fp: r.documentFingerprint,
        sfp: r.sourceFingerprint,
        source: r.source,
        status: r.reviewStatus,
        reason: r.uncertaintyReason,
        createdAt: r.createdAt,
      })),
      gsi: gsis.filter((r) => Number(r.amount) === amount).map((r) => ({
        table: "GSI",
        id: r.id,
        supplier: r.supplierName,
        amount: r.amount,
        gmail: r.gmailMessageId,
        email: r.emailMessageId,
        file: r.attachmentFilename,
        duplicateKey: r.duplicateKey,
        status: r.reviewStatus,
        createdAt: r.createdAt,
      })),
      invoice: invoices.filter((r) => Number(r.amount) === amount),
      payment: payments.filter((r) => Number(r.amount) === amount).map((r) => ({
        table: "SupplierPayment",
        id: r.id,
        supplier: r.supplier,
        amount: r.amount,
        email: r.emailMessageId,
        fp: r.documentFingerprint,
        sfp: r.sourceFingerprint,
        source: r.source,
        dup: r.duplicateDetected,
        dupReason: r.duplicateReason,
        createdAt: r.createdAt,
      })),
    };
  }

  // Check buildInvoiceListWhere filters - what reviewStatus / documentType would exclude
  // Also check if BOTH GSI and FDR would be returned by typical where
  const { buildInvoiceListWhereInput } = await import("./src/routes/api.ts").catch(() => ({ buildInvoiceListWhereInput: null }));

  // Count rows that share fingerprint across tables
  const cross = [];
  for (const amount of AMOUNTS) {
    const f = fdrs.filter((r) => Number(r.totalAmount) === amount);
    const g = gsis.filter((r) => Number(r.amount) === amount);
    for (const fr of f) {
      const gMatch = g.filter((x) => x.gmailMessageId === fr.gmailMessageId || x.duplicateKey === fr.documentFingerprint);
      cross.push({
        amount,
        fdrId: fr.id,
        gsiMatches: gMatch.map((x) => x.id),
        sameFpAsDupKey: gMatch.some((x) => x.duplicateKey === fr.documentFingerprint),
        fdrBeforeGsiMs: gMatch[0] ? gMatch[0].createdAt.getTime() - fr.createdAt.getTime() : null,
      });
    }
  }

  // Scan overlapping runs near 11:10
  const scans = await prisma.scanLog.findMany({
    where: {
      orgId: ORG,
      startedAt: { gte: new Date("2026-07-26T10:55:00.000Z"), lte: new Date("2026-07-26T11:20:00.000Z") },
    },
    orderBy: { startedAt: "asc" },
  });

  const out = {
    byAmount,
    cross,
    emailMsgs: emailMsgs.map((e) => ({
      id: e.id,
      gmailId: e.gmailId,
      subject: e.subject,
      from: e.fromAddress,
      processedAt: e.processedAt,
      receivedAt: e.receivedAt,
      createdAt: e.createdAt,
    })),
    scans: scans.map((s) => ({
      id: s.id,
      type: s.type,
      status: s.status,
      found: s.found,
      saved: s.saved,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      errors: s.errors,
    })),
    // Hypothesis: UI shows GSI + FDR if merge broken OR frontend shows both screens
    hypothesis: {
      dbTrueDuplicatesSameTable: AMOUNTS.every((a) => fdrs.filter((r) => Number(r.totalAmount) === a).length <= 1),
      pairedFdrAndGsiPerDoc: cross.every((c) => c.gsiMatches.length === 1),
      mergeShouldShowOne: true,
      ifUserSeesTwo: "Likely API/UI merge regression OR second source not in these tables OR frontend double-render from two endpoints",
    },
  };

  writeFileSync(join(process.cwd(), "_tmp-dup-all-sources.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
}).finally(() => prisma.$disconnect());
