/**
 * backfill-payment-hygiene — תיקון נתונים היסטוריים ב-SupplierPayment. ללא מיגרציה.
 *
 * מתקן:
 *   1. supplier / supplierName שמתחילים ב-'known:' או 'canonical:' → השם הנקי בלבד
 *   2. normalizedDocumentDate IS NULL ברשומות מאושרות → date, ואם אין — createdAt
 *
 * ברירת מחדל: --dry-run (קריאה בלבד, מדפיס מה ישתנה). כתיבה רק עם --apply.
 * כל העדכונים ב-transaction אחת. אידמפוטנטי: הרצה חוזרת לא משנה דבר.
 *
 * הרצה:
 *   dry-run מול פרודקשן: ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/backfill-payment-hygiene.ts
 *   apply  מול פרודקשן: ALLOW_REMOTE_WRITE=1 npx tsx scripts/backfill-payment-hygiene.ts --apply
 */
import { prisma } from "../src/lib/prisma.js";

const APPLY = process.argv.includes("--apply");
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);

if (!isLocal && !APPLY && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("🛑 DATABASE_URL אינו localhost. ל-dry-run מול פרודקשן הוסף ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}
if (!isLocal && APPLY && process.env.ALLOW_REMOTE_WRITE !== "1") {
  console.error("🛑 --apply מול DB מרוחק דורש ALLOW_REMOTE_WRITE=1 במפורש. עצירה.");
  process.exit(1);
}
console.log(APPLY ? "🔴 APPLY MODE — יבוצעו עדכונים בתוך transaction.\n" : "🟢 DRY-RUN — קריאה בלבד, שום עדכון לא יבוצע.\n");

const INTERNAL_KEY_REGEX = /^(?:known|canonical):\s*/i;

function stripKey(value: string): string {
  let cleaned = value.trim();
  while (INTERNAL_KEY_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(INTERNAL_KEY_REGEX, "").trim();
  }
  return cleaned;
}

type SupplierFix = { id: string; field: "supplier" | "supplierName"; from: string; to: string };
type DateFix = { id: string; supplier: string; source: "date" | "createdAt"; to: Date };

async function main() {
  // ---- סריקה 1: מפתחות פנימיים בשדות הספק ----
  const leaked = await prisma.supplierPayment.findMany({
    where: {
      OR: [
        { supplier: { startsWith: "known:" } },
        { supplier: { startsWith: "canonical:" } },
        { supplierName: { startsWith: "known:" } },
        { supplierName: { startsWith: "canonical:" } },
      ],
    },
    select: { id: true, organizationId: true, supplier: true, supplierName: true, amount: true, approvalStatus: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const supplierFixes: SupplierFix[] = [];
  for (const p of leaked) {
    if (p.supplier && INTERNAL_KEY_REGEX.test(p.supplier.trim())) {
      const to = stripKey(p.supplier);
      if (to && to !== p.supplier) supplierFixes.push({ id: p.id, field: "supplier", from: p.supplier, to });
    }
    if (p.supplierName && INTERNAL_KEY_REGEX.test(p.supplierName.trim())) {
      const to = stripKey(p.supplierName);
      if (to && to !== p.supplierName) supplierFixes.push({ id: p.id, field: "supplierName", from: p.supplierName, to });
    }
  }

  // ---- סריקה 2: normalizedDocumentDate חסר באישורים ----
  const nullDates = await prisma.supplierPayment.findMany({
    where: { approvalStatus: "approved", normalizedDocumentDate: null },
    select: { id: true, organizationId: true, supplier: true, date: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const dateFixes: DateFix[] = nullDates.map((p) => {
    const fromDate = p.date instanceof Date && !Number.isNaN(p.date.getTime()) ? p.date : null;
    return {
      id: p.id,
      supplier: p.supplier,
      source: fromDate ? ("date" as const) : ("createdAt" as const),
      to: fromDate ?? p.createdAt,
    };
  });

  // ---- הדפסת מה ישתנה ----
  console.log("=".repeat(72));
  console.log(`1 | תיקוני שם ספק (${supplierFixes.length} עדכוני-שדה על ${leaked.length} רשומות שנסרקו)`);
  console.log("=".repeat(72));
  for (const fix of supplierFixes) {
    console.log(`  ${fix.id} | ${fix.field}: "${fix.from}" -> "${fix.to}"`);
  }
  if (!supplierFixes.length) console.log("  (אין — נקי)");

  console.log("\n" + "=".repeat(72));
  console.log(`2 | מילוי normalizedDocumentDate (${dateFixes.length} רשומות)`);
  console.log("=".repeat(72));
  for (const fix of dateFixes) {
    console.log(`  ${fix.id} | supplier="${fix.supplier}" | normalizedDocumentDate <- ${fix.to.toISOString()} (מקור: ${fix.source})`);
  }
  if (!dateFixes.length) console.log("  (אין — נקי)");

  const touchedIds = new Set([...supplierFixes.map((f) => f.id), ...dateFixes.map((f) => f.id)]);
  console.log("\n" + "-".repeat(72));
  console.log(`סיכום סריקה: נסרקו ${leaked.length + nullDates.length} שורות-תוצאה | רשומות ייחודיות שישתנו: ${touchedIds.size}`);
  console.log(`  תיקוני supplier/supplierName: ${supplierFixes.length} | מילויי normalizedDocumentDate: ${dateFixes.length}`);
  console.log(`  דולגו (נסרקו ללא צורך בשינוי): ${leaked.length + nullDates.length - touchedIds.size >= 0 ? Math.max(0, leaked.length - new Set(supplierFixes.map((f) => f.id)).size) : 0}`);

  if (!APPLY) {
    console.log("\n🟢 DRY-RUN הסתיים — שום דבר לא שונה. להרצה אמיתית: --apply");
    return;
  }

  // ---- APPLY: כל העדכונים ב-transaction אחת ----
  const supplierUpdatesByRecord = new Map<string, { supplier?: string; supplierName?: string }>();
  for (const fix of supplierFixes) {
    const entry = supplierUpdatesByRecord.get(fix.id) ?? {};
    entry[fix.field] = fix.to;
    supplierUpdatesByRecord.set(fix.id, entry);
  }
  const ops = [
    ...[...supplierUpdatesByRecord.entries()].map(([id, data]) =>
      prisma.supplierPayment.update({ where: { id }, data })
    ),
    ...dateFixes.map((fix) =>
      prisma.supplierPayment.update({ where: { id: fix.id }, data: { normalizedDocumentDate: fix.to } })
    ),
  ];
  console.log(`\nמבצע ${ops.length} עדכונים ב-transaction אחת...`);
  await prisma.$transaction(ops);
  console.log("✔ ה-transaction הושלמה.");

  // ---- אימות אחרי apply ----
  console.log("\n" + "=".repeat(72));
  console.log("אימות אחרי apply");
  console.log("=".repeat(72));
  const remainingKnown = await prisma.supplierPayment.count({ where: { supplier: { startsWith: "known:" } } });
  const remainingCanonical = await prisma.supplierPayment.count({ where: { supplier: { startsWith: "canonical:" } } });
  const remainingNameKeys = await prisma.supplierPayment.count({
    where: { OR: [{ supplierName: { startsWith: "known:" } }, { supplierName: { startsWith: "canonical:" } }] },
  });
  const remainingNullDates = await prisma.supplierPayment.count({
    where: { approvalStatus: "approved", normalizedDocumentDate: null },
  });
  console.log(`supplier LIKE 'known:%'        : ${remainingKnown}`);
  console.log(`supplier LIKE 'canonical:%'    : ${remainingCanonical}`);
  console.log(`supplierName עם מפתח פנימי     : ${remainingNameKeys}`);
  console.log(`approved עם normalizedDate NULL: ${remainingNullDates}`);
  const clean = remainingKnown === 0 && remainingCanonical === 0 && remainingNameKeys === 0 && remainingNullDates === 0;
  console.log(clean ? "\n✅ האימות עבר — אין שאריות." : "\n❌ נותרו שאריות — יש לבדוק לפני הרצה חוזרת.");
  if (!clean) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("שגיאה:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
