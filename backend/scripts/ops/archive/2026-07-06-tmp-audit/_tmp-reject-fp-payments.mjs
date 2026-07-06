import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const execute = process.argv.includes("--execute");
const fp = "f83950c2b05646c9d45ba9b6afbdb9f08e4b0f812f7d0bf4";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL } },
});

const payments = await prisma.supplierPayment.findMany({
  where: { documentFingerprint: fp, approvalStatus: { not: "rejected" } },
  select: { id: true, approvalStatus: true, organizationId: true },
});

console.log(JSON.stringify({ payments, execute }, null, 2));

if (execute) {
  for (const p of payments) {
    await prisma.supplierPayment.update({
      where: { id: p.id },
      data: {
        approvalStatus: "rejected",
        duplicateDetected: true,
        notes: "P0-3.3: blocked_outcome_persisted remediation",
      },
    });
  }
  console.log("Rejected", payments.length, "payments");
}

await prisma.$disconnect();
