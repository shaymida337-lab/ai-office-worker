import { config as loadEnv } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}
if (existsSync(join(process.cwd(), ".env.render-db.tmp"))) {
  loadEnv({ path: join(process.cwd(), ".env.render-db.tmp"), override: true });
}

import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  try {
    const row = await p.financialDocumentReview.findUnique({
      where: { id: "cmrlx4g0y0011jk282xm3o8kv" },
    });
    const pf = row?.parsedFieldsJson as Record<string, unknown> | null;
    writeFileSync(
      join(process.cwd(), "_tmp-verify", "img4764-fdr.json"),
      JSON.stringify(
        {
          supplierName: row?.supplierName,
          totalAmount: row?.totalAmount,
          documentDate: row?.documentDate,
          documentType: row?.documentType,
          reviewStatus: row?.reviewStatus,
          confidenceScore: row?.confidenceScore,
          uncertaintyReason: row?.uncertaintyReason,
          parsedKeys: pf ? Object.keys(pf) : [],
          parsed: pf,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log("wrote _tmp-verify/img4764-fdr.json");
    console.log("supplier", row?.supplierName);
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
