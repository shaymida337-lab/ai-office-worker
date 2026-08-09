import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
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
    const row = await p.financialDocumentReview.findUnique({ where: { id: "cmrlx4g0y0011jk282xm3o8kv" } });
    console.log(
      JSON.stringify(
        {
          driveFileUrl: row?.driveFileUrl,
          fileName: row?.fileName,
          paymentId: row?.supplierPaymentId,
          parsed: row?.parsedFieldsJson,
        },
        null,
        2,
      ),
    );
    const pay = await p.supplierPayment.findUnique({ where: { id: "cmrlxzldk0007mp2c22y8xq38" } });
    console.log(
      "payment links",
      JSON.stringify(
        {
          documentLink: pay?.documentLink,
          invoiceLink: pay?.invoiceLink,
          driveFileUrl: pay?.driveFileUrl,
          supplier: pay?.supplier,
        },
        null,
        2,
      ),
    );
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
