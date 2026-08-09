/**
 * Readonly: inspect latest Shay camera /uploads invoice path vs local disk presence.
 * Does not change anything; does not call Render SSH/Jobs.
 */
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
import {
  isFinancialIngestionContainmentActive,
  isFinancialDataContainmentActive,
} from "./src/services/p0/financialContainment.js";

const SHAY = "cmpjd7j7e0001bl5tzv049rxb";

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.financialDocumentReview.findMany({
      where: {
        organizationId: SHAY,
        OR: [
          { driveFileUrl: { startsWith: "/uploads/" } },
          { fileName: { contains: "4764" } },
          { supplierName: { contains: "וולט הדר" } },
          { supplierName: { contains: "יוסי" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        fileName: true,
        supplierName: true,
        driveFileUrl: true,
        driveUploadStatus: true,
        source: true,
        reviewStatus: true,
        totalAmount: true,
        updatedAt: true,
        createdAt: true,
        supplierPaymentId: true,
        parsedFieldsJson: true,
      },
    });

    const pays = await prisma.supplierPayment.findMany({
      where: {
        organizationId: SHAY,
        OR: [
          { documentLink: { startsWith: "/uploads/" } },
          { invoiceLink: { startsWith: "/uploads/" } },
          { driveFileUrl: { startsWith: "/uploads/" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        supplier: true,
        amount: true,
        documentLink: true,
        invoiceLink: true,
        driveFileUrl: true,
        driveUploadStatus: true,
        updatedAt: true,
      },
    });

    const report = rows.map((r) => {
      const rel = (r.driveFileUrl ?? "").replace(/^\//, "");
      const localCandidate = rel ? join(process.cwd(), rel) : null;
      return {
        id: r.id,
        fileName: r.fileName,
        supplierName: r.supplierName,
        driveFileUrl: r.driveFileUrl,
        driveUploadStatus: r.driveUploadStatus,
        source: r.source,
        amount: r.totalAmount,
        updatedAt: r.updatedAt,
        localPathChecked: localCandidate,
        localExistsHere: localCandidate ? existsSync(localCandidate) : false,
        cameraSha:
          r.parsedFieldsJson && typeof r.parsedFieldsJson === "object"
            ? (r.parsedFieldsJson as { camera?: { fileSha256?: string } }).camera?.fileSha256 ?? null
            : null,
      };
    });

    console.log(
      JSON.stringify(
        {
          containment: {
            FINANCIAL_DATA_CONTAINMENT: process.env.FINANCIAL_DATA_CONTAINMENT ?? "<unset>",
            FINANCIAL_INGESTION_CONTAINMENT: process.env.FINANCIAL_INGESTION_CONTAINMENT ?? "<unset>",
            FINANCIAL_READ_CONTAINMENT: process.env.FINANCIAL_READ_CONTAINMENT ?? "<unset>",
            isFinancialDataContainmentActive: isFinancialDataContainmentActive(),
            isFinancialIngestionContainmentActive: isFinancialIngestionContainmentActive(),
            NODE_ENV: process.env.NODE_ENV ?? "<unset>",
          },
          reviews: report,
          payments: pays,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
