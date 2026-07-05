/**
 * scan-quality-report.ts — דוח איכות צינור הסריקה (read-only).
 *
 * מדפיס טבלת מדדים על GmailScanItem / FinancialDocumentReview /
 * SupplierPayment / Invoice: ספקים חסרים/זבל, סכומים חשודים, תאריכים
 * בעייתיים (בפילוח מקור), כפילויות חשודות בתוך ובין טבלאות, קישורי Drive
 * חסרים, פילוח reviewStatus, ופער early-NEEDS_REVIEW (FDR בלי GSI).
 *
 * בטיחות: מסרב לרוץ אם DATABASE_URL אינו localhost. קריאה בלבד — אין כתיבות.
 *
 * הרצה: cd backend && npx tsx scripts/scan-quality-report.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { isLikelyJunkSupplierName } from "../src/services/supplierNameValidation.js";

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
const allowRemote = process.env.ALLOW_REMOTE_READONLY_REPORT === "1";
if (host !== "localhost" && host !== "127.0.0.1" && !allowRemote) {
  console.error(`REFUSING TO RUN: DATABASE_URL host is "${host}" (not localhost).`);
  console.error("להרצת baseline בפרודקשן (Render Shell, קריאה בלבד): ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}
if (allowRemote && host !== "localhost" && host !== "127.0.0.1") {
  console.error(`⚠️  REMOTE READ-ONLY MODE: running against host "${host}". הסקריפט מבצע קריאות בלבד.`);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const MAX_AMOUNT = 1_000_000;
const now = new Date();
const oneYearAhead = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
const twoYearsBack = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
const twoYearsAhead = new Date(now.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);

type Row = {
  table: string;
  organizationId: string;
  source: string;
  supplier: string | null;
  amount: number | null;
  date: Date | null;
  normalizedDocumentDate: Date | null;
  driveLink: string | null;
  reviewStatus?: string | null;
  gmailMessageId?: string | null;
  /** FDR בלבד: קישור לתשלום שנוצר ממנה (זוג by-design, לא כפילות) */
  linkedSupplierPaymentId?: string | null;
  /** SupplierPayment בלבד */
  id?: string;
};

function isMissingSupplier(s: string | null): boolean {
  return !s || !s.trim();
}
function isJunkSupplier(s: string | null): boolean {
  return !!s && !!s.trim() && isLikelyJunkSupplierName(s);
}
function dayKey(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "no-date";
}
function dupKey(r: Row): string | null {
  if (isMissingSupplier(r.supplier) || isJunkSupplier(r.supplier)) return null;
  if (r.amount == null || r.amount <= 0) return null;
  const date = r.normalizedDocumentDate ?? r.date;
  if (!date) return null;
  return [r.organizationId, r.supplier!.trim().toLowerCase(), r.amount.toFixed(2), dayKey(date)].join("|");
}
function pct(n: number, total: number): string {
  return total ? `${((100 * n) / total).toFixed(1)}%` : "-";
}

async function loadRows(): Promise<Row[]> {
  const [gsi, fdr, sp, inv] = await Promise.all([
    prisma.gmailScanItem.findMany({
      select: {
        organizationId: true, supplierName: true, amount: true, occurredAt: true,
        normalizedDocumentDate: true, driveFileLink: true, reviewStatus: true, gmailMessageId: true,
      },
    }),
    prisma.financialDocumentReview.findMany({
      select: {
        organizationId: true, source: true, supplierName: true, totalAmount: true, documentDate: true,
        normalizedDocumentDate: true, driveFileUrl: true, reviewStatus: true, gmailMessageId: true,
        supplierPaymentId: true,
      },
    }),
    prisma.supplierPayment.findMany({
      select: {
        id: true, organizationId: true, source: true, supplier: true, amount: true, totalAmount: true, date: true,
        normalizedDocumentDate: true, driveFileUrl: true, documentLink: true, invoiceLink: true, approvalStatus: true,
      },
    }),
    prisma.invoice.findMany({
      select: {
        organizationId: true, supplierName: true, amount: true, date: true,
        normalizedDocumentDate: true, driveUrl: true, driveFileUrl: true, status: true,
      },
    }),
  ]);

  return [
    ...gsi.map((r): Row => ({
      table: "GmailScanItem", organizationId: r.organizationId, source: "gmail",
      supplier: r.supplierName, amount: r.amount, date: r.occurredAt,
      normalizedDocumentDate: r.normalizedDocumentDate, driveLink: r.driveFileLink,
      reviewStatus: r.reviewStatus, gmailMessageId: r.gmailMessageId,
    })),
    ...fdr.map((r): Row => ({
      table: "FinancialDocumentReview", organizationId: r.organizationId, source: r.source,
      supplier: r.supplierName, amount: r.totalAmount, date: r.documentDate,
      normalizedDocumentDate: r.normalizedDocumentDate, driveLink: r.driveFileUrl,
      reviewStatus: r.reviewStatus, gmailMessageId: r.gmailMessageId,
      linkedSupplierPaymentId: r.supplierPaymentId,
    })),
    ...sp.map((r): Row => ({
      id: r.id,
      table: "SupplierPayment", organizationId: r.organizationId, source: r.source,
      supplier: r.supplier, amount: r.amount, date: r.date,
      normalizedDocumentDate: r.normalizedDocumentDate,
      driveLink: r.driveFileUrl ?? r.documentLink ?? r.invoiceLink,
      reviewStatus: r.approvalStatus,
    })),
    ...inv.map((r): Row => ({
      table: "Invoice", organizationId: r.organizationId, source: "gmail",
      supplier: r.supplierName, amount: r.amount, date: r.date,
      normalizedDocumentDate: r.normalizedDocumentDate,
      driveLink: r.driveUrl ?? r.driveFileUrl, reviewStatus: r.status,
    })),
  ];
}

function printSection(title: string) {
  console.log(`\n=== ${title} ===`);
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return new Map([...m.entries()].sort((a, b) => b[1] - a[1]));
}

async function main() {
  const rows = await loadRows();
  const tables = ["GmailScanItem", "FinancialDocumentReview", "SupplierPayment", "Invoice"];
  const byTable = new Map(tables.map((t) => [t, rows.filter((r) => r.table === t)]));

  console.log(`scan-quality-report | ${now.toISOString()} | host=${host}`);
  console.log(tables.map((t) => `${t}=${byTable.get(t)!.length}`).join(" | "));

  // ---- 1. ספקים ----
  printSection("1. ספק חסר / זבל");
  console.log("table                     | total | missing | junk  | junk%");
  for (const t of tables) {
    const list = byTable.get(t)!;
    const missing = list.filter((r) => isMissingSupplier(r.supplier)).length;
    const junk = list.filter((r) => isJunkSupplier(r.supplier)).length;
    console.log(
      `${t.padEnd(25)} | ${String(list.length).padStart(5)} | ${String(missing).padStart(7)} | ${String(junk).padStart(5)} | ${pct(junk + missing, list.length)}`
    );
  }
  const junkExamples = countBy(rows.filter((r) => isJunkSupplier(r.supplier)), (r) => r.supplier!.trim());
  if (junkExamples.size) {
    console.log("-- דוגמאות ספק-זבל (top 15):");
    [...junkExamples.entries()].slice(0, 15).forEach(([name, n]) => console.log(`   ${n}x  ${JSON.stringify(name.slice(0, 80))}`));
  }

  // ---- 2. סכומים ----
  printSection("2. סכומים חשודים (0 / >=1M / null)");
  console.log("table                     | zero | >=1M | null");
  for (const t of tables) {
    const list = byTable.get(t)!;
    const zero = list.filter((r) => r.amount === 0).length;
    const huge = list.filter((r) => r.amount != null && r.amount >= MAX_AMOUNT).length;
    const nul = list.filter((r) => r.amount == null).length;
    console.log(`${t.padEnd(25)} | ${String(zero).padStart(4)} | ${String(huge).padStart(4)} | ${String(nul).padStart(4)}`);
  }

  // ---- 2b. amount=0 בפילוח מקור (תוספת שלב 0) ----
  printSection("2b. amount=0 לפי מקור");
  const zeroBySource = countBy(rows.filter((r) => r.amount === 0), (r) => `${r.table} / ${r.source}`);
  if (!zeroBySource.size) console.log("(אין)");
  zeroBySource.forEach((n, k) => console.log(`${k.padEnd(40)} | ${n}`));

  // ---- 3. תאריכים ----
  printSection("3. תאריך מסמך חסר / עתידי (>=שנה) / normalizedDocumentDate ריק");
  console.log("table                     | date-null | future>=1y | normDate-null");
  for (const t of tables) {
    const list = byTable.get(t)!;
    const docDate = (r: Row) => r.normalizedDocumentDate ?? r.date;
    const missing = list.filter((r) => !docDate(r)).length;
    const future = list.filter((r) => docDate(r) && docDate(r)! >= oneYearAhead).length;
    const normNull = list.filter((r) => !r.normalizedDocumentDate).length;
    console.log(`${t.padEnd(25)} | ${String(missing).padStart(9)} | ${String(future).padStart(10)} | ${String(normNull).padStart(13)}`);
  }

  // ---- 3b. תאריכים בעייתיים לפי מקור (אימות ממצא F4) ----
  printSection("3b. תאריכים בעייתיים לפי מקור (F4: גבול ±2 שנים חסר ב-whatsapp/camera)");
  console.log("table / source                           | missing | future>=1y | out-of-±2y");
  const sourceKeys = countBy(rows, (r) => `${r.table} / ${r.source}`);
  for (const key of sourceKeys.keys()) {
    const list = rows.filter((r) => `${r.table} / ${r.source}` === key);
    const docDate = (r: Row) => r.normalizedDocumentDate ?? r.date;
    const missing = list.filter((r) => !docDate(r)).length;
    const future = list.filter((r) => docDate(r) && docDate(r)! >= oneYearAhead).length;
    const outOfRange = list.filter((r) => {
      const d = docDate(r);
      return d && (d < twoYearsBack || d > twoYearsAhead);
    }).length;
    console.log(`${key.padEnd(40)} | ${String(missing).padStart(7)} | ${String(future).padStart(10)} | ${String(outOfRange).padStart(10)}`);
  }

  // ---- 4. כפילויות חשודות ----
  printSection("4. כפילויות חשודות (אותו ארגון+ספק+סכום+תאריך)");
  const withKeys = rows
    .map((r) => ({ r, key: dupKey(r) }))
    .filter((x): x is { r: Row; key: string } => x.key !== null);
  const groups = new Map<string, Row[]>();
  for (const { r, key } of withKeys) {
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  // החרגת זוגות by-design: FDR שמקושרת (supplierPaymentId) לתשלום שנמצא באותה קבוצה
  let linkedMirrorPairs = 0;
  const dupGroups = [...groups.entries()]
    .map(([key, list]): [string, Row[]] => {
      const paymentIds = new Set(list.filter((r) => r.table === "SupplierPayment").map((r) => r.id));
      const filtered = list.filter((r) => {
        const isLinkedMirror =
          r.table === "FinancialDocumentReview" &&
          r.linkedSupplierPaymentId != null &&
          paymentIds.has(r.linkedSupplierPaymentId);
        if (isLinkedMirror) linkedMirrorPairs++;
        return !isLinkedMirror;
      });
      return [key, filtered];
    })
    .filter(([, list]) => list.length > 1);
  const withinTable = dupGroups.filter(([, list]) => new Set(list.map((r) => r.table)).size === 1);
  const crossTable = dupGroups.filter(([, list]) => new Set(list.map((r) => r.table)).size > 1);
  console.log(`זוגות FDR↔Payment מקושרים (by-design, הוחרגו): ${linkedMirrorPairs}`);
  const surplus = (gs: [string, Row[]][]) => gs.reduce((acc, [, list]) => acc + list.length - 1, 0);
  console.log(`קבוצות כפולות בתוך אותה טבלה : ${withinTable.length} (עודף רשומות: ${surplus(withinTable)})`);
  console.log(`קבוצות כפולות בין טבלאות     : ${crossTable.length} (עודף רשומות: ${surplus(crossTable)})`);
  const perTablePairs = countBy(
    withinTable, ([, list]) => list[0].table,
  );
  perTablePairs.forEach((n, t) => console.log(`   בתוך ${t}: ${n} קבוצות`));
  const sample = [...dupGroups]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  if (sample.length) {
    console.log("-- דוגמאות (top 10 לפי גודל קבוצה):");
    for (const [key, list] of sample) {
      const [, supplier, amount, day] = key.split("|");
      const tablesIn = countBy(list, (r) => r.table);
      const spread = [...tablesIn.entries()].map(([t, n]) => `${t}x${n}`).join(", ");
      console.log(`   ${list.length}x ${JSON.stringify(supplier.slice(0, 40))} ${amount} ${day}  [${spread}]`);
    }
  }

  // ---- 5. קישורי Drive חסרים ----
  printSection("5. רשומות בלי קישור Drive, לפי טבלה/מקור");
  console.log("table / source                           | no-link | total | %");
  for (const key of sourceKeys.keys()) {
    const list = rows.filter((r) => `${r.table} / ${r.source}` === key);
    const noLink = list.filter((r) => !r.driveLink || !r.driveLink.trim()).length;
    console.log(`${key.padEnd(40)} | ${String(noLink).padStart(7)} | ${String(list.length).padStart(5)} | ${pct(noLink, list.length)}`);
  }

  // ---- 6. פילוח reviewStatus ----
  printSection("6. GmailScanItem לפי reviewStatus");
  const gsiStatuses = countBy(byTable.get("GmailScanItem")!, (r) => r.reviewStatus ?? "null");
  gsiStatuses.forEach((n, s) => console.log(`${s.padEnd(20)} | ${n}`));
  printSection("6b. FinancialDocumentReview לפי reviewStatus");
  const fdrStatuses = countBy(byTable.get("FinancialDocumentReview")!, (r) => r.reviewStatus ?? "null");
  fdrStatuses.forEach((n, s) => console.log(`${s.padEnd(20)} | ${n}`));

  // ---- 7. פער early-NEEDS_REVIEW: FDR מ-gmail בלי GSI תואם ----
  printSection("7. FDR (source=gmail) עם gmailMessageId ללא GmailScanItem תואם (early-NEEDS_REVIEW gap)");
  const gsiByOrgMsg = new Set(
    byTable.get("GmailScanItem")!.map((r) => `${r.organizationId}|${r.gmailMessageId}`)
  );
  const fdrGmail = byTable.get("FinancialDocumentReview")!.filter((r) => r.source === "gmail" && r.gmailMessageId);
  const orphanFdr = fdrGmail.filter((r) => !gsiByOrgMsg.has(`${r.organizationId}|${r.gmailMessageId}`));
  console.log(`FDR מ-gmail עם gmailMessageId : ${fdrGmail.length}`);
  console.log(`מתוכם ללא GSI תואם            : ${orphanFdr.length} (${pct(orphanFdr.length, fdrGmail.length)})`);
  const orphanByStatus = countBy(orphanFdr, (r) => r.reviewStatus ?? "null");
  orphanByStatus.forEach((n, s) => console.log(`   status=${s.padEnd(15)} | ${n}`));

  console.log("\n=== סוף דוח ===");
}

main()
  .catch((err) => {
    console.error("scan-quality-report failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
