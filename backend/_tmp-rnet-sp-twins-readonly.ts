/**
 * READ-ONLY: SupplierPayment twin correlation for missing vs present FDRs.
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
const CASES = [
  { label: "rnet_missing", fdrId: "cmqw3n5hx020dm92bp1joi8wu" },
  { label: "bezeq_missing", fdrId: "cmqw3onmp0227m92bemcb1bkm" },
  { label: "shaykedma_missing", fdrId: "cmqxeh4bh0audjx2d6ncvt92u" },
  { label: "ramatgan_present", fdrId: "cmqxf61ak0b2zjx2dna3832rx" },
  { label: "detected_present", fdrId: "cmqxf65y40b31jx2d0snodln4" },
];

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const out = [];
    for (const c of CASES) {
      const fdr = await prisma.financialDocumentReview.findUnique({ where: { id: c.fdrId } });
      if (!fdr) continue;
      const sps = await prisma.supplierPayment.findMany({
        where: {
          organizationId: ORG,
          OR: [
            ...(fdr.documentFingerprint
              ? [{ OR: [{ documentFingerprint: fdr.documentFingerprint }, { duplicateKey: fdr.documentFingerprint }] } as any]
              : []),
            ...(fdr.emailMessageId ? [{ emailMessageId: fdr.emailMessageId }] : []),
            ...(fdr.gmailMessageId ? [{ gmailMessageId: fdr.gmailMessageId }] : []),
            { amount: fdr.totalAmount ?? undefined, supplierName: fdr.supplierName ?? undefined },
          ].filter(Boolean),
        },
        select: {
          id: true,
          approvalStatus: true,
          amount: true,
          totalAmount: true,
          supplierName: true,
          documentTypeDetailed: true,
          emailMessageId: true,
        },
        take: 10,
      });
      // Also by exact amount+approx name
      const spsByAmount = await prisma.supplierPayment.findMany({
        where: {
          organizationId: ORG,
          OR: [{ amount: fdr.totalAmount ?? -1 }, { totalAmount: fdr.totalAmount ?? -1 }],
        },
        select: {
          id: true,
          approvalStatus: true,
          amount: true,
          totalAmount: true,
          supplierName: true,
          emailMessageId: true,
          invoiceNumber: true,
        },
        take: 20,
      });
      out.push({
        label: c.label,
        fdr: {
          id: fdr.id,
          supplierPaymentId: fdr.supplierPaymentId,
          amount: fdr.totalAmount,
          invoiceNumber: fdr.invoiceNumber,
          fingerprint: fdr.documentFingerprint,
          emailMessageId: fdr.emailMessageId,
          documentType: fdr.documentType,
        },
        linkedByRefs: sps,
        sameAmount: spsByAmount.filter(
          (s) =>
            s.emailMessageId === fdr.emailMessageId ||
            s.invoiceNumber === fdr.invoiceNumber ||
            (fdr.supplierName && s.supplierName && s.supplierName.includes(fdr.supplierName.slice(0, 4))),
        ),
      });
    }
    writeFileSync(join(process.cwd(), "_tmp-rnet-sp-twins.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
