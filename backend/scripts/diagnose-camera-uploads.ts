/**
 * READ-ONLY: 10 ההעלאות הישירות האחרונות ממסך /camera.
 * findMany בלבד — אפס פעולות כתיבה.
 * הרצה: npm exec -w backend -- tsx scripts/diagnose-camera-uploads.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const rows = await prisma.financialDocumentReview.findMany({
    where: { source: "camera" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      fileName: true,
      source: true,
      supplierName: true,
      totalAmount: true,
      reviewStatus: true,
      uncertaintyReason: true,
      driveUploadStatus: true,
    },
  });

  if (rows.length === 0) {
    console.log(
      "אפס רשומות camera ⇒ שלב השמירה (POST /camera/invoices) מעולם לא הושלם — ההעלאות מתו בשלב ה-preview (U1/U2/U3/U5)."
    );
    return;
  }

  console.log(`נמצאו ${rows.length} העלאות camera (החדשה ראשונה):\n`);
  for (const row of rows) {
    console.log(
      [
        `id=${row.id}`,
        `createdAt=${row.createdAt.toISOString()}`,
        `fileName=${row.fileName ?? "-"}`,
        `source=${row.source}`,
        `supplierName=${row.supplierName ?? "-"}`,
        `totalAmount=${row.totalAmount ?? "null"}`,
        `reviewStatus=${row.reviewStatus}`,
        `uncertaintyReason=${row.uncertaintyReason ?? "-"}`,
        `driveUploadStatus=${row.driveUploadStatus ?? "-"}`,
      ].join(" | ")
    );
  }
}

main()
  .catch((err) => {
    console.error("[diagnose-camera-uploads] failed", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
