/**
 * READ-ONLY: diagnose duplicate invoice cards (GENERAL TIRE 450, Superpharm 918)
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n"; // kedmashopd1
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW" }));
  process.exit(2);
}

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

function slimFdr(r: any) {
  return {
    id: r.id,
    supplierName: r.supplierName,
    totalAmount: r.totalAmount,
    gmailMessageId: r.gmailMessageId,
    emailMessageId: r.emailMessageId ?? null,
    fileName: r.fileName,
    documentFingerprint: r.documentFingerprint,
    sourceFingerprint: r.sourceFingerprint,
    source: r.source,
    documentType: r.documentType,
    reviewStatus: r.reviewStatus,
    uncertaintyReason: r.uncertaintyReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    subject: r.subject,
    sender: r.sender,
  };
}

async function main() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const recentFdr = await prisma.financialDocumentReview.findMany({
    where: {
      organizationId: ORG,
      createdAt: { gte: since },
      OR: [
        { totalAmount: 450 },
        { totalAmount: 918 },
        { supplierName: { contains: "GENERAL", mode: "insensitive" } },
        { supplierName: { contains: "TIRE", mode: "insensitive" } },
        { supplierName: { contains: "סופר" } },
        { supplierName: { contains: "פארם" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  // Also broader recent invoice-like for context
  const recentAll = await prisma.financialDocumentReview.findMany({
    where: {
      organizationId: ORG,
      createdAt: { gte: since },
      totalAmount: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      supplierName: true,
      totalAmount: true,
      gmailMessageId: true,
      documentFingerprint: true,
      sourceFingerprint: true,
      source: true,
      reviewStatus: true,
      createdAt: true,
      fileName: true,
    },
  });

  // Group by amount+approx supplier
  const tire = recentFdr.filter(
    (r) =>
      Number(r.totalAmount) === 450 ||
      /general|tire/i.test(r.supplierName ?? "") ||
      /ג'?נרל|צמיג/i.test(r.supplierName ?? "")
  );
  const pharm = recentFdr.filter(
    (r) => Number(r.totalAmount) === 918 || /סופר\s*פארם|super\s*pharm/i.test(r.supplierName ?? "")
  );

  const focusIds = [...new Set([...tire, ...pharm].map((r) => r.id))];
  const focus = recentFdr.filter((r) => focusIds.includes(r.id));

  const gmailIds = [...new Set(focus.map((r) => r.gmailMessageId).filter(Boolean))] as string[];
  const fingerprints = [...new Set(focus.map((r) => r.documentFingerprint).filter(Boolean))] as string[];
  const sourceFps = [...new Set(focus.map((r) => r.sourceFingerprint).filter(Boolean))] as string[];

  const relatedByGmail = gmailIds.length
    ? await prisma.financialDocumentReview.findMany({
        where: { organizationId: ORG, gmailMessageId: { in: gmailIds } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const relatedByFp = fingerprints.length
    ? await prisma.financialDocumentReview.findMany({
        where: { organizationId: ORG, documentFingerprint: { in: fingerprints } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const gsi = await prisma.gmailScanItem.findMany({
    where: {
      organizationId: ORG,
      OR: [
        ...(gmailIds.length ? [{ gmailMessageId: { in: gmailIds } }] : []),
        ...(focus.map((f) => f.fileName).filter(Boolean).length
          ? [{ attachmentFilename: { in: focus.map((f) => f.fileName!).filter(Boolean) } }]
          : []),
        { createdAt: { gte: since }, amount: { in: [450, 918] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: ORG,
      OR: [
        ...(gmailIds.length ? [{ gmailMessageId: { in: gmailIds } }] : []),
        { amount: { in: [450, 918] }, createdAt: { gte: since } },
        { supplierName: { contains: "GENERAL", mode: "insensitive" } },
        { supplierName: { contains: "סופר" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      supplierName: true,
      amount: true,
      gmailMessageId: true,
      createdAt: true,
      emailId: true,
      status: true,
      description: true,
    },
  });

  let scanLogs: any[] = [];
  try {
    scanLogs = await prisma.scanLog.findMany({
      where: { orgId: ORG, startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: 15,
    });
  } catch (e: any) {
    scanLogs = [{ error: String(e?.message ?? e) }];
  }

  // Pair analysis helpers
  function pairAnalysis(rows: typeof focus, label: string) {
    const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const ids = sorted.map((r) => r.id);
    const gmails = [...new Set(sorted.map((r) => r.gmailMessageId))];
    const fps = [...new Set(sorted.map((r) => r.documentFingerprint))];
    const sfps = [...new Set(sorted.map((r) => r.sourceFingerprint))];
    const sources = [...new Set(sorted.map((r) => r.source))];
    const files = [...new Set(sorted.map((r) => r.fileName))];
    const deltasMs =
      sorted.length >= 2
        ? sorted.slice(1).map((r, i) => r.createdAt.getTime() - sorted[i].createdAt.getTime())
        : [];
    return {
      label,
      count: sorted.length,
      ids,
      uniqueGmailMessageIds: gmails,
      uniqueDocumentFingerprints: fps,
      uniqueSourceFingerprints: sfps,
      uniqueSources: sources,
      uniqueFileNames: files,
      createdAtDeltaMs: deltasMs,
      sameGmail: gmails.length === 1 && gmails[0] != null,
      sameFingerprint: fps.length === 1 && fps[0] != null,
      sameSourceFp: sfps.length === 1 && sfps[0] != null,
      sameFile: files.length === 1,
      rows: sorted.map(slimFdr),
    };
  }

  const gsiSlim = gsi.map((g) => ({
    id: g.id,
    gmailMessageId: g.gmailMessageId,
    attachmentFilename: g.attachmentFilename,
    supplierName: g.supplierName,
    amount: g.amount,
    documentType: g.documentType,
    decisionReason: g.decisionReason?.slice?.(0, 200) ?? g.decisionReason,
    createdAt: g.createdAt,
    scanLogId: (g as any).scanLogId ?? null,
    status: (g as any).status ?? null,
  }));

  // Match GSI to FDR by gmail + filename/amount
  const pairsDetailed = [];
  for (const f of [...tire, ...pharm]) {
    const matches = gsi.filter(
      (g) =>
        (f.gmailMessageId && g.gmailMessageId === f.gmailMessageId) ||
        (f.fileName && g.attachmentFilename === f.fileName) ||
        (f.totalAmount != null && Number(g.amount) === Number(f.totalAmount) && g.supplierName === f.supplierName)
    );
    pairsDetailed.push({
      fdr: slimFdr(f),
      matchedGsi: matches.map((g) => ({
        id: g.id,
        gmailMessageId: g.gmailMessageId,
        attachmentFilename: g.attachmentFilename,
        amount: g.amount,
        supplierName: g.supplierName,
        createdAt: g.createdAt,
      })),
    });
  }

  const out = {
    orgId: ORG,
    since: since.toISOString(),
    recentInvoiceLikeCount: recentAll.length,
    recentAll,
    tirePair: pairAnalysis(tire, "GENERAL_TIRE_450"),
    pharmPair: pairAnalysis(pharm, "SUPERPHARM_918"),
    relatedByGmail: relatedByGmail.map(slimFdr),
    relatedByFp: relatedByFp.map(slimFdr),
    gsi: gsiSlim,
    invoices,
    scanLogs,
    pairsDetailed,
  };

  writeFileSync(join(process.cwd(), "_tmp-dup-invoice-cards-diag.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        tireCount: tire.length,
        pharmCount: pharm.length,
        gsiCount: gsi.length,
        invoiceCount: invoices.length,
        scanLogs: scanLogs.length,
        tirePair: out.tirePair,
        pharmPair: out.pharmPair,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
