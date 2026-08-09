/**
 * report-payment-hygiene — דוח read-only לקראת backfill (ללא שום כתיבה).
 *
 * מדווח:
 *   1. SupplierPayment עם supplier שמתחיל ב-'known:' / 'canonical:' (מפתח פנימי שדלף)
 *   2. SupplierPayment מאושרים עם normalizedDocumentDate IS NULL (בלתי-נראים בדליית חודשים)
 *
 * הרצה מול פרודקשן: ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/report-payment-hygiene.ts
 */
import { prisma } from "../src/lib/prisma.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
if (!isLocal && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("🛑 DATABASE_URL אינו localhost. להרצה מול פרודקשן (קריאה בלבד) הוסף ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}
if (!isLocal) console.log("⚠️  READ-ONLY MODE — קריאות בלבד, שום כתיבה.\n");

async function main() {
  console.log("=".repeat(72));
  console.log("1 | SupplierPayment עם מפתח פנימי בשדה supplier (known:/canonical:)");
  console.log("=".repeat(72));
  const leaked = await prisma.supplierPayment.findMany({
    where: {
      OR: [{ supplier: { startsWith: "known:" } }, { supplier: { startsWith: "canonical:" } }],
    },
    select: {
      id: true,
      organizationId: true,
      supplier: true,
      supplierName: true,
      amount: true,
      approvalStatus: true,
      paid: true,
      documentTypeDetailed: true,
      normalizedDocumentDate: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`סה"כ: ${leaked.length} רשומות`);
  for (const p of leaked) {
    console.log(
      `  ${p.id} | org=${p.organizationId} | supplier="${p.supplier}" (supplierName=${p.supplierName ?? "null"}) | ` +
        `amount=${p.amount} | approval=${p.approvalStatus} | paid=${p.paid} | type=${p.documentTypeDetailed} | ` +
        `normDate=${p.normalizedDocumentDate?.toISOString() ?? "null"} | created=${p.createdAt.toISOString()}`
    );
  }
  const proposedFix = leaked.map((p) => ({
    id: p.id,
    from: p.supplier,
    to: p.supplier.replace(/^(?:known|canonical):\s*/i, "").trim(),
  }));
  if (proposedFix.length) {
    console.log(`\nתיקון מוצע (ל-backfill עתידי, לא מבוצע):`);
    for (const fix of proposedFix) console.log(`  ${fix.id}: "${fix.from}" -> "${fix.to}"`);
  }

  console.log("\n" + "=".repeat(72));
  console.log("2 | SupplierPayment מאושרים עם normalizedDocumentDate IS NULL");
  console.log("=".repeat(72));
  const nullDates = await prisma.supplierPayment.findMany({
    where: { approvalStatus: "approved", normalizedDocumentDate: null },
    select: {
      id: true,
      organizationId: true,
      supplier: true,
      amount: true,
      paid: true,
      documentTypeDetailed: true,
      date: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`סה"כ: ${nullDates.length} רשומות (בלתי-נראות בדליית חודשים/ארכיון)`);
  const byOrg = new Map<string, number>();
  for (const p of nullDates) byOrg.set(p.organizationId, (byOrg.get(p.organizationId) ?? 0) + 1);
  console.log(`פילוח לפי ארגון: ${[...byOrg.entries()].map(([org, n]) => `${org}=${n}`).join(", ") || "(אין)"}`);
  for (const p of nullDates.slice(0, 30)) {
    console.log(
      `  ${p.id} | org=${p.organizationId} | supplier="${p.supplier}" | amount=${p.amount} | paid=${p.paid} | ` +
        `type=${p.documentTypeDetailed} | date=${p.date?.toISOString?.() ?? p.date ?? "null"} | created=${p.createdAt.toISOString()}`
    );
  }
  if (nullDates.length > 30) console.log(`  ... ועוד ${nullDates.length - 30}`);
  console.log(`\nתיקון מוצע (ל-backfill עתידי, לא מבוצע): normalizedDocumentDate = date ?? createdAt`);

  console.log("\n--- סוף דוח (קריאה בלבד) ---");
}

main()
  .catch((err) => {
    console.error("שגיאה:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
