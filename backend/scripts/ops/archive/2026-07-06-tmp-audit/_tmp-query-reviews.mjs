import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

const ids = ["cmr24980300adkg2cu1g63nz5", "cmr1wetwb000fg82cl5onpqbi"];
for (const id of ids) {
  const r = await prisma.financialDocumentReview.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      gmailMessageId: true,
      documentFingerprint: true,
      supplierPaymentId: true,
    },
  });
  console.log(JSON.stringify(r));
}

await prisma.$disconnect();
