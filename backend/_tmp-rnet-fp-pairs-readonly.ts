import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const FP_RNET = "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf";
const FP_BEZEQ = "327f78265d110edc5b3b6f37c4bfb903393eff044c295250";

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const out = {
      rnet: {
        gsi: await prisma.gmailScanItem.findMany({
          where: { organizationId: ORG, duplicateKey: FP_RNET },
          select: {
            id: true,
            gmailMessageId: true,
            reviewStatus: true,
            decisionReason: true,
            supplierName: true,
            amount: true,
            documentType: true,
          },
        }),
        fdr: await prisma.financialDocumentReview.findMany({
          where: { organizationId: ORG, documentFingerprint: FP_RNET },
          select: {
            id: true,
            gmailMessageId: true,
            reviewStatus: true,
            uncertaintyReason: true,
            supplierName: true,
            totalAmount: true,
            documentType: true,
          },
        }),
      },
      bezeq: {
        gsi: await prisma.gmailScanItem.findMany({
          where: { organizationId: ORG, duplicateKey: FP_BEZEQ },
          select: {
            id: true,
            gmailMessageId: true,
            reviewStatus: true,
            decisionReason: true,
            supplierName: true,
            amount: true,
            documentType: true,
          },
        }),
        fdr: await prisma.financialDocumentReview.findMany({
          where: { organizationId: ORG, documentFingerprint: FP_BEZEQ },
          select: {
            id: true,
            gmailMessageId: true,
            reviewStatus: true,
            uncertaintyReason: true,
            supplierName: true,
            totalAmount: true,
            documentType: true,
          },
        }),
      },
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-fp-pairs.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
