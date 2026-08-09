/**
 * READ-ONLY: check for duplicate FDRs of the Yellow/Isracard document in kedma org
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
const FDR_ID = "cms1nvpvp00pbjn2cwks9a78b";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW" }));
  process.exit(2);
}

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

async function main() {
  const focus = await prisma.financialDocumentReview.findFirst({
    where: { id: FDR_ID, organizationId: ORG },
  });
  if (!focus) {
    console.log(JSON.stringify({ error: "focus FDR missing" }));
    return;
  }

  const sameFp = await prisma.financialDocumentReview.findMany({
    where: {
      organizationId: ORG,
      OR: [
        { documentFingerprint: focus.documentFingerprint || undefined },
        { sourceFingerprint: focus.sourceFingerprint || undefined },
        { gmailMessageId: focus.gmailMessageId || undefined },
        { totalAmount: 418.39 },
        { supplierName: { contains: "ישרא" } },
        { supplierName: { contains: "yellow", mode: "insensitive" } },
        { supplierName: { contains: "פז" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      supplierName: true,
      totalAmount: true,
      fileName: true,
      gmailMessageId: true,
      documentFingerprint: true,
      sourceFingerprint: true,
      documentType: true,
      reviewStatus: true,
      uncertaintyReason: true,
      createdAt: true,
      subject: true,
    },
  });

  // Also: recent invoice-like cards (last 6h)
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const recent = await prisma.financialDocumentReview.findMany({
    where: {
      organizationId: ORG,
      createdAt: { gte: since },
      OR: [
        { documentType: { contains: "invoice" } },
        { totalAmount: { not: null } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      supplierName: true,
      totalAmount: true,
      fileName: true,
      gmailMessageId: true,
      documentFingerprint: true,
      sourceFingerprint: true,
      documentType: true,
      uncertaintyReason: true,
      createdAt: true,
    },
  });

  const out = {
    focusId: focus.id,
    focusFp: focus.documentFingerprint,
    focusSfp: focus.sourceFingerprint,
    focusGmail: focus.gmailMessageId,
    relatedHits: sameFp.map((r) => ({
      ...r,
      sameDocFp: r.documentFingerprint === focus.documentFingerprint,
      sameSrcFp: r.sourceFingerprint === focus.sourceFingerprint,
      sameGmail: r.gmailMessageId === focus.gmailMessageId,
    })),
    recentInvoiceLike: recent,
  };
  writeFileSync(join(process.cwd(), "_tmp-yellow-dup-check.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
