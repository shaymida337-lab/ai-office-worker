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

const SHAY = "cmpjd7j7e0001bl5tzv049rxb";

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: SHAY,
        OR: [
          { fileName: { contains: "4764" } },
          { supplierName: { contains: "וולט" } },
          { supplierName: { contains: "יוסי" } },
          { supplierName: { contains: "פיצוחי" } },
          { supplierName: { contains: "הדר" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: {
        id: true,
        fileName: true,
        supplierName: true,
        totalAmount: true,
        documentDate: true,
        reviewStatus: true,
        uncertaintyReason: true,
        supplierPaymentId: true,
        driveFileUrl: true,
        updatedAt: true,
        createdAt: true,
        parsedFieldsJson: true,
      },
    });
    console.log(JSON.stringify(rows, null, 2));

    // also payments
    const pays = await prisma.supplierPayment.findMany({
      where: {
        organizationId: SHAY,
        OR: [
          { supplier: { contains: "וולט הדר" } },
          { supplierName: { contains: "וולט הדר" } },
          { supplier: { contains: "יוסי" } },
          { supplierName: { contains: "פיצוחי" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        supplier: true,
        supplierName: true,
        amount: true,
        approvalStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    console.log("payments", JSON.stringify(pays, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
