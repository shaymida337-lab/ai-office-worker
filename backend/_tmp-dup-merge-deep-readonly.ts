/**
 * READ-ONLY: deep dive duplicate cards = GSI + FDR merge?
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
const TARGETS = [
  { label: "GENERAL_TIRE_450", amount: 450, supplierRe: /general|tire/i, fdrId: "cms1p5fn1008rj81sxvqogrc8" },
  { label: "SUPERPHARM_918", amount: 918, supplierRe: /סופר|pharm/i, fdrId: "cms1p5woj008zj81s99yq2wfp" },
];

const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW" }));
  process.exit(2);
}

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

function simulateMerge(input: {
  invoices: { id: string; gmailMessageId: string | null; emailId: string | null; amount: number; supplierName: string | null }[];
  gsis: { id: string; gmailMessageId: string; emailMessageId: string | null; amount: number | null; supplierName: string; attachmentFilename: string | null }[];
  fdrs: { id: string; gmailMessageId: string | null; emailMessageId: string | null; totalAmount: number | null; supplierName: string | null; supplierPaymentId: string | null }[];
  payments: { id: string; emailMessageId: string | null; amount: number; supplier: string }[];
}) {
  const existingInvoiceRefs = new Set(
    input.invoices.flatMap((invoice) => [invoice.gmailMessageId, invoice.emailId].filter((v): v is string => Boolean(v)))
  );
  const usedReviewRefs = new Set<string>();
  const usedPaymentIds = new Set<string>();

  const cards: any[] = [];

  for (const invoice of input.invoices) {
    cards.push({ kind: "invoice", id: invoice.id, supplier: invoice.supplierName, amount: invoice.amount, gmail: invoice.gmailMessageId });
  }

  for (const item of input.gsis) {
    if (existingInvoiceRefs.has(item.gmailMessageId) || (item.emailMessageId && existingInvoiceRefs.has(item.emailMessageId))) continue;
    if (item.gmailMessageId) usedReviewRefs.add(`gmail:${item.gmailMessageId}`);
    if (item.emailMessageId) usedReviewRefs.add(`email:${item.emailMessageId}`);
    cards.push({ kind: "gmail_scan_item", id: item.id, supplier: item.supplierName, amount: item.amount, gmail: item.gmailMessageId, file: item.attachmentFilename });
  }

  for (const payment of input.payments) {
    if (payment.emailMessageId && existingInvoiceRefs.has(payment.emailMessageId)) continue;
    usedPaymentIds.add(payment.id);
    if (payment.emailMessageId) usedReviewRefs.add(`email:${payment.emailMessageId}`);
    cards.push({ kind: "supplier_payment", id: payment.id, supplier: payment.supplier, amount: payment.amount, gmail: null });
  }

  for (const item of input.fdrs) {
    if (item.supplierPaymentId && usedPaymentIds.has(item.supplierPaymentId)) continue;
    const refs = [item.gmailMessageId && `gmail:${item.gmailMessageId}`, item.emailMessageId && `email:${item.emailMessageId}`].filter((v): v is string => Boolean(v));
    if (refs.some((ref) => existingInvoiceRefs.has(ref.replace(/^(gmail|email):/, "")) || usedReviewRefs.has(ref))) continue;
    refs.forEach((ref) => usedReviewRefs.add(ref));
    cards.push({ kind: "financial_document_review", id: item.id, supplier: item.supplierName, amount: item.totalAmount, gmail: item.gmailMessageId });
  }

  return cards;
}

async function main() {
  const results = [];

  for (const t of TARGETS) {
    const fdr = await prisma.financialDocumentReview.findFirst({
      where: { id: t.fdrId, organizationId: ORG },
    });
    if (!fdr) {
      results.push({ label: t.label, error: "FDR not found" });
      continue;
    }

    const gmailId = fdr.gmailMessageId;
    const emailId = fdr.emailMessageId;

    const fdrsSameGmail = gmailId
      ? await prisma.financialDocumentReview.findMany({ where: { organizationId: ORG, gmailMessageId: gmailId } })
      : [fdr];

    const fdrsSameAmount = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: ORG,
        totalAmount: t.amount,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "asc" },
    });

    const gsis = await prisma.gmailScanItem.findMany({
      where: {
        organizationId: ORG,
        OR: [
          ...(gmailId ? [{ gmailMessageId: gmailId }] : []),
          ...(emailId ? [{ emailMessageId: emailId }] : []),
          { amount: t.amount, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          ...(fdr.fileName ? [{ attachmentFilename: fdr.fileName }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    // Filter GSI to relevant ones (same amount or same gmail)
    const relevantGsi = gsis.filter(
      (g) =>
        (gmailId && g.gmailMessageId === gmailId) ||
        Number(g.amount) === t.amount ||
        (fdr.fileName && g.attachmentFilename === fdr.fileName && Math.abs(Number(g.amount) - t.amount) < 0.01)
    );

    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: ORG,
        OR: [
          ...(gmailId ? [{ gmailMessageId: gmailId }] : []),
          { amount: t.amount, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        ],
      },
      select: { id: true, supplierName: true, amount: true, gmailMessageId: true, emailId: true, createdAt: true },
    });

    const payments = await prisma.supplierPayment.findMany({
      where: {
        organizationId: ORG,
        OR: [
          ...(emailId ? [{ emailMessageId: emailId }] : []),
          { amount: t.amount, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          { supplier: { contains: t.label.includes("TIRE") ? "GENERAL" : "סופר", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        supplier: true,
        amount: true,
        emailMessageId: true,
        documentFingerprint: true,
        sourceFingerprint: true,
        duplicateDetected: true,
        duplicateReason: true,
        createdAt: true,
        source: true,
      },
      take: 20,
    });

    const relevantPayments = payments.filter(
      (p) => Number(p.amount) === t.amount || (emailId && p.emailMessageId === emailId)
    );

    // Simulate merge with ALL recent list candidates that would include these
    // (use the relevant set around this document)
    const mergeCards = simulateMerge({
      invoices: invoices.filter((i) => Number(i.amount) === t.amount || i.gmailMessageId === gmailId),
      gsis: relevantGsi.map((g) => ({
        id: g.id,
        gmailMessageId: g.gmailMessageId,
        emailMessageId: g.emailMessageId,
        amount: g.amount,
        supplierName: g.supplierName,
        attachmentFilename: g.attachmentFilename,
      })),
      fdrs: fdrsSameAmount.map((r) => ({
        id: r.id,
        gmailMessageId: r.gmailMessageId,
        emailMessageId: r.emailMessageId,
        totalAmount: r.totalAmount,
        supplierName: r.supplierName,
        supplierPaymentId: r.supplierPaymentId,
      })),
      payments: relevantPayments.map((p) => ({
        id: p.id,
        emailMessageId: p.emailMessageId,
        amount: p.amount,
        supplier: p.supplier,
      })),
    });

    const amountCards = mergeCards.filter((c) => Number(c.amount) === t.amount);

    // Scan logs around creation
    const created = fdr.createdAt;
    const windowStart = new Date(created.getTime() - 10 * 60 * 1000);
    const windowEnd = new Date(created.getTime() + 10 * 60 * 1000);
    const scanLogs = await prisma.scanLog.findMany({
      where: { orgId: ORG, startedAt: { gte: windowStart, lte: windowEnd } },
      orderBy: { startedAt: "asc" },
    });

    results.push({
      label: t.label,
      fdr: {
        id: fdr.id,
        supplierName: fdr.supplierName,
        totalAmount: fdr.totalAmount,
        gmailMessageId: fdr.gmailMessageId,
        emailMessageId: fdr.emailMessageId,
        fileName: fdr.fileName,
        documentFingerprint: fdr.documentFingerprint,
        sourceFingerprint: fdr.sourceFingerprint,
        source: fdr.source,
        reviewStatus: fdr.reviewStatus,
        uncertaintyReason: fdr.uncertaintyReason,
        createdAt: fdr.createdAt,
        supplierPaymentId: fdr.supplierPaymentId,
      },
      fdrsSameGmail: fdrsSameGmail.map((r) => ({
        id: r.id,
        amount: r.totalAmount,
        supplier: r.supplierName,
        fp: r.documentFingerprint,
        createdAt: r.createdAt,
        status: r.reviewStatus,
      })),
      fdrsSameAmount: fdrsSameAmount.map((r) => ({
        id: r.id,
        amount: r.totalAmount,
        supplier: r.supplierName,
        gmail: r.gmailMessageId,
        fp: r.documentFingerprint,
        createdAt: r.createdAt,
        status: r.reviewStatus,
        reason: r.uncertaintyReason,
      })),
      gsi: relevantGsi.map((g) => ({
        id: g.id,
        gmailMessageId: g.gmailMessageId,
        emailMessageId: g.emailMessageId,
        attachmentFilename: g.attachmentFilename,
        supplierName: g.supplierName,
        amount: g.amount,
        duplicateKey: g.duplicateKey,
        reviewStatus: g.reviewStatus,
        createdAt: g.createdAt,
        decisionReason: String(g.decisionReason ?? "").slice(0, 180),
      })),
      invoices: invoices.filter((i) => Number(i.amount) === t.amount || i.gmailMessageId === gmailId),
      payments: relevantPayments,
      simulatedMergeAll: mergeCards,
      simulatedMergeAmountOnly: amountCards,
      duplicateDiagnosis: {
        fdrCountSameAmount: fdrsSameAmount.length,
        gsiCountRelevant: relevantGsi.length,
        invoiceCount: invoices.filter((i) => Number(i.amount) === t.amount || i.gmailMessageId === gmailId).length,
        paymentCount: relevantPayments.length,
        mergeCardCountForAmount: amountCards.length,
        mergeKinds: amountCards.map((c) => c.kind),
        sameGmailBetweenGsiAndFdr:
          relevantGsi.some((g) => g.gmailMessageId === gmailId) && Boolean(gmailId),
        gsiGmailIds: [...new Set(relevantGsi.map((g) => g.gmailMessageId))],
        fdrGmailIds: [...new Set(fdrsSameAmount.map((r) => r.gmailMessageId))],
      },
      scanLogsAroundCreate: scanLogs.map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        found: s.found,
        saved: s.saved,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        errors: s.errors,
      })),
    });
  }

  // Also: recent FDR+GSI pairs for ALL new invoices in last 2h to see pattern
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const recentFdr = await prisma.financialDocumentReview.findMany({
    where: { organizationId: ORG, createdAt: { gte: since }, totalAmount: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      supplierName: true,
      totalAmount: true,
      gmailMessageId: true,
      fileName: true,
      documentFingerprint: true,
      reviewStatus: true,
      createdAt: true,
      uncertaintyReason: true,
    },
  });
  const recentPattern = [];
  for (const r of recentFdr) {
    const gsi = r.gmailMessageId
      ? await prisma.gmailScanItem.findMany({
          where: { organizationId: ORG, gmailMessageId: r.gmailMessageId },
          select: { id: true, amount: true, supplierName: true, duplicateKey: true, createdAt: true, attachmentFilename: true },
        })
      : [];
    const pay = r.gmailMessageId
      ? []
      : [];
    recentPattern.push({
      fdrId: r.id,
      supplier: r.supplierName,
      amount: r.totalAmount,
      gmail: r.gmailMessageId,
      fdrStatus: r.reviewStatus,
      reason: r.uncertaintyReason,
      gsiCount: gsi.length,
      gsiIds: gsi.map((g) => g.id),
      wouldMergeDuplicate:
        gsi.length >= 1
          ? "GSI present — FDR should be suppressed IF same gmail ref used"
          : "no GSI",
    });
  }

  const out = { checkedAt: new Date().toISOString(), results, recentPattern };
  writeFileSync(join(process.cwd(), "_tmp-dup-merge-deep.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
