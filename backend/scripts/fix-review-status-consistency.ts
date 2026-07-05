/**
 * fix-review-status-consistency.ts — תיקון חד-פעמי לרשומות ישנות (שלב 6).
 *
 * מה הסקריפט מתקן:
 * רשומות GmailScanItem שנדרסו בעבר ל-needs_review ע"י שגיאת עיבוד מאוחרת
 * (decisionReason מתחיל ב-"process_save_failed") למרות שהרשומה הפיננסית
 * (SupplierPayment או Invoice) נשמרה בהצלחה עבור אותה הודעה — כלומר
 * החשבונית נקלטה תקין והסטטוס הנכון הוא auto_saved ("מאושר" בתצוגה).
 *
 * ⚠️ ברירת המחדל: DRY-RUN — מדפיס מה ישתנה, לא משנה כלום.
 *    שינוי בפועל: הוספת הדגל --apply.
 *
 * ── סדר הרצה בפרודקשן (אחרי deploy של שלב 6) ──────────────────────────
 * 1. גיבוי: ודא שיש snapshot/גיבוי עדכני ל-DB לפני כל שינוי.
 * 2. dry-run:      npx tsx scripts/fix-review-status-consistency.ts
 *    (מדפיס את כל הרשומות המועמדות; לעבור עליהן ידנית!)
 * 3. הרצה בפועל:   npx tsx scripts/fix-review-status-consistency.ts --apply
 * 4. אימות:        npx tsx scripts/scan-quality-report.ts
 *    (סעיף 6 בדוח — פילוח reviewStatus — אמור להראות את המעבר)
 * ─────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { isUsableSupplierNameShared } from "../src/services/supplier/supplierValidation.js";

const APPLY = process.argv.includes("--apply");
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(join(backendRoot, ".env"), "utf8");
  const line = envText.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in backend/.env");
  return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

const databaseUrl = loadDatabaseUrl();
const host = new URL(databaseUrl.replace(/^postgresql:/, "http:")).hostname;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main() {
  console.log(`fix-review-status-consistency | ${new Date().toISOString()} | host=${host} | mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  if (!APPLY) console.log("(dry-run: שום דבר לא ישתנה. להרצה בפועל: --apply)\n");

  // מועמדים: GSI שנדרס ל-needs_review ע"י שגיאה מאוחרת
  const downgraded = await prisma.gmailScanItem.findMany({
    where: {
      reviewStatus: "needs_review",
      decisionReason: { startsWith: "process_save_failed" },
    },
    select: {
      id: true, organizationId: true, gmailMessageId: true, supplierName: true,
      amount: true, decisionReason: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // קריטריון מחודד (אחרי dry-run ראשון בפרודקשן שתפס רשומות זבל):
  // משחזרים רק רשומה שהיא *עצמה* מסמך תקין שנשמר בהצלחה —
  //   1. ספק תקין (לא מייל/מספר עוסק/זבל — אותה ולידציה של הצינור)
  //   2. סכום חיובי
  //   3. תשלום/חשבונית מקושרים לאותה הודעה עם *אותו סכום* (±0.01) —
  //      הוכחה שהמסמך הזה עצמו נקלט, לא "אח" שלו מאותה הודעה.
  // רשומות שכשלו בעיבוד (JSON-fail / prisma-create-fail) נופלות באחד
  // מהמסננים האלה ונשארות ב-needs_review — שם מקומן.
  const candidates: typeof downgraded = [];
  const skipped = { junkSupplier: 0, missingAmount: 0, noMatchingRecord: 0 };
  const skippedExamples: string[] = [];
  for (const item of downgraded) {
    const supplierOk = Boolean(item.supplierName) && isUsableSupplierNameShared(item.supplierName);
    if (!supplierOk) {
      skipped.junkSupplier++;
      skippedExamples.push(`  SKIP (ספק לא תקין) ${item.id} | supplier="${item.supplierName}" | amount=${item.amount ?? "-"}`);
      continue;
    }
    const amountOk = typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0;
    if (!amountOk) {
      skipped.missingAmount++;
      skippedExamples.push(`  SKIP (סכום חסר/אפס) ${item.id} | supplier="${item.supplierName}" | amount=${item.amount ?? "-"}`);
      continue;
    }
    const amountWindow = { gte: item.amount! - 0.01, lte: item.amount! + 0.01 };
    const email = await prisma.emailMessage.findFirst({
      where: { organizationId: item.organizationId, gmailId: item.gmailMessageId },
      select: { id: true },
    });
    const [payment, invoice] = await Promise.all([
      email
        ? prisma.supplierPayment.findFirst({
            where: { organizationId: item.organizationId, emailMessageId: email.id, amount: amountWindow },
            select: { id: true },
          })
        : Promise.resolve(null),
      prisma.invoice.findFirst({
        where: { organizationId: item.organizationId, gmailMessageId: item.gmailMessageId, amount: amountWindow },
        select: { id: true },
      }),
    ]);
    if (payment || invoice) {
      candidates.push(item);
    } else {
      skipped.noMatchingRecord++;
      skippedExamples.push(`  SKIP (אין רשומה מקושרת באותו סכום) ${item.id} | supplier="${item.supplierName}" | amount=${item.amount}`);
    }
  }

  console.log(`GSI שנדרסו ע"י שגיאה מאוחרת: ${downgraded.length}`);
  console.log(`נפסלו — ספק זבל/מייל/ח"פ: ${skipped.junkSupplier} | סכום חסר/אפס: ${skipped.missingAmount} | אין רשומה מקושרת תואמת-סכום: ${skipped.noMatchingRecord}`);
  console.log(`מועמדים לשחזור ל-auto_saved (עברו את כל המסננים): ${candidates.length}\n`);
  if (skippedExamples.length) {
    console.log("--- נפסלו (נשארים ב-needs_review, שם מקומם) ---");
    for (const line of skippedExamples) console.log(line);
    console.log("");
  }

  for (const item of candidates) {
    console.log(
      `  ${APPLY ? "UPDATING" : "WOULD UPDATE"} GmailScanItem ${item.id} | org=${item.organizationId} | supplier="${item.supplierName}" | amount=${item.amount ?? "-"} | gmail=${item.gmailMessageId} | reason="${item.decisionReason.slice(0, 60)}..."`
    );
    if (APPLY) {
      await prisma.gmailScanItem.update({
        where: { id: item.id },
        data: {
          reviewStatus: "auto_saved",
          decisionReason: `restored_after_late_failure (was: ${item.decisionReason.slice(0, 400)})`,
        },
      });
    }
  }

  console.log(`\n${APPLY ? "עודכנו" : "יעודכנו"} ${candidates.length} רשומות.`);
  if (!APPLY && candidates.length) console.log("להרצה בפועל: npx tsx scripts/fix-review-status-consistency.ts --apply");
}

main()
  .catch((err) => {
    console.error("fix-review-status-consistency failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
