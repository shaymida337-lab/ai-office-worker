/**
 * find-duplicates.ts — איתור כפילויות קיימות לניקוי ידני (שלב 4).
 *
 * READ-ONLY בלבד: הסקריפט מדפיס כפילויות חשודות עם סיבת החשד לכל קבוצה —
 * הוא לא מוחק, לא מעדכן ולא "מתקן" שום דבר. הניקוי עצמו ידני בלבד.
 *
 * בטיחות: מסרב לרוץ אם DATABASE_URL אינו localhost.
 * הרצה: cd backend && npx tsx scripts/find-duplicates.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

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
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`REFUSING TO RUN: DATABASE_URL host is "${host}" (not localhost). Read-only local script.`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

type Suspect = {
  table: string;
  id: string;
  organizationId: string;
  supplier: string | null;
  amount: number | null;
  date: Date | null;
  invoiceNumber?: string | null;
  gmailMessageId?: string | null;
  attachmentFilename?: string | null;
  linkedSupplierPaymentId?: string | null;
  createdAt: Date;
};

type DuplicateGroup = {
  reason: string;
  reasonCode: string;
  members: Suspect[];
};

function dayKey(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "no-date";
}

function fmt(s: Suspect): string {
  return `      ${s.table} id=${s.id} supplier="${s.supplier ?? "-"}" amount=${s.amount ?? "-"} date=${dayKey(s.date)} inv#=${s.invoiceNumber ?? "-"} gmail=${s.gmailMessageId ?? "-"} created=${s.createdAt.toISOString().slice(0, 19)}`;
}

function groupBy(items: Suspect[], key: (s: Suspect) => string | null): Map<string, Suspect[]> {
  const map = new Map<string, Suspect[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

async function main() {
  const [gsi, fdr, sp, inv] = await Promise.all([
    prisma.gmailScanItem.findMany({
      select: {
        id: true, organizationId: true, supplierName: true, amount: true, occurredAt: true,
        normalizedDocumentDate: true, gmailMessageId: true, attachmentFilename: true, createdAt: true,
      },
    }),
    prisma.financialDocumentReview.findMany({
      select: {
        id: true, organizationId: true, supplierName: true, totalAmount: true, documentDate: true,
        invoiceNumber: true, gmailMessageId: true, supplierPaymentId: true, createdAt: true,
      },
    }),
    prisma.supplierPayment.findMany({
      select: {
        id: true, organizationId: true, supplier: true, amount: true, date: true,
        invoiceNumber: true, emailMessageId: true, createdAt: true,
      },
    }),
    prisma.invoice.findMany({
      select: {
        id: true, organizationId: true, supplierName: true, amount: true, date: true,
        invoiceNumber: true, gmailMessageId: true, createdAt: true,
      },
    }),
  ]);

  const suspects: Suspect[] = [
    ...gsi.map((r): Suspect => ({
      table: "GmailScanItem", id: r.id, organizationId: r.organizationId, supplier: r.supplierName,
      amount: r.amount, date: r.normalizedDocumentDate ?? r.occurredAt, gmailMessageId: r.gmailMessageId,
      attachmentFilename: r.attachmentFilename, createdAt: r.createdAt,
    })),
    ...fdr.map((r): Suspect => ({
      table: "FinancialDocumentReview", id: r.id, organizationId: r.organizationId, supplier: r.supplierName,
      amount: r.totalAmount, date: r.documentDate, invoiceNumber: r.invoiceNumber,
      gmailMessageId: r.gmailMessageId, linkedSupplierPaymentId: r.supplierPaymentId, createdAt: r.createdAt,
    })),
    ...sp.map((r): Suspect => ({
      table: "SupplierPayment", id: r.id, organizationId: r.organizationId, supplier: r.supplier,
      amount: r.amount, date: r.date, invoiceNumber: r.invoiceNumber, createdAt: r.createdAt,
    })),
    ...inv.map((r): Suspect => ({
      table: "Invoice", id: r.id, organizationId: r.organizationId, supplier: r.supplierName,
      amount: r.amount, date: r.date, invoiceNumber: r.invoiceNumber, gmailMessageId: r.gmailMessageId, createdAt: r.createdAt,
    })),
  ];

  const groups: DuplicateGroup[] = [];

  // ---- 1. אותה הודעת Gmail עם יותר מרשומה אחת באותה טבלה ----
  // (GSI: פר-קובץ מצורף זה לגיטימי — מקבצים לפי הודעה+קובץ; סימפטום F6)
  for (const table of ["GmailScanItem", "Invoice", "FinancialDocumentReview"]) {
    const byMsg = groupBy(
      suspects.filter((s) => s.table === table && s.gmailMessageId),
      (s) =>
        table === "GmailScanItem"
          ? `${s.organizationId}|${s.gmailMessageId}|${s.attachmentFilename ?? ""}`
          : `${s.organizationId}|${s.gmailMessageId}`
    );
    for (const [, members] of byMsg) {
      if (members.length > 1) {
        groups.push({
          reasonCode: "same_gmail_message",
          reason: `אותה הודעת Gmail הולידה ${members.length} רשומות ${table} (צפוי: אחת${table === "GmailScanItem" ? " פר-קובץ מצורף" : ""})`,
          members,
        });
      }
    }
  }

  // ---- 2. אותו מספר חשבונית + סכום (בתוך SupplierPayment / Invoice) ----
  for (const table of ["SupplierPayment", "Invoice"]) {
    const byInvNum = groupBy(
      suspects.filter((s) => s.table === table && s.invoiceNumber && s.amount != null && s.amount > 0),
      (s) => `${s.organizationId}|${s.invoiceNumber!.trim().toLowerCase()}|${s.amount!.toFixed(2)}`
    );
    for (const [, members] of byInvNum) {
      if (members.length > 1) {
        groups.push({
          reasonCode: "invoice_number_and_amount",
          reason: `אותו מספר חשבונית ואותו סכום ב-${members.length} רשומות ${table} — כמעט ודאי כפילות`,
          members,
        });
      }
    }
  }

  // ---- 3. אותו ספק+סכום+יום, בתוך ובין טבלאות ----
  // זהירות: שני חיובים שונים מאותו ספק באותו סכום הם תרחיש אמיתי —
  // לכן זו רק *חשודה* (סיבת חשד מפורשת), וזוגות FDR↔Payment מקושרים מוחרגים.
  const byBusinessKey = groupBy(
    suspects.filter((s) => s.supplier && s.supplier.trim() && s.amount != null && s.amount > 0 && s.date),
    (s) => `${s.organizationId}|${s.supplier!.trim().toLowerCase()}|${s.amount!.toFixed(2)}|${dayKey(s.date)}`
  );
  for (const [, rawMembers] of byBusinessKey) {
    const paymentIds = new Set(rawMembers.filter((m) => m.table === "SupplierPayment").map((m) => m.id));
    const members = rawMembers.filter(
      (m) => !(m.table === "FinancialDocumentReview" && m.linkedSupplierPaymentId && paymentIds.has(m.linkedSupplierPaymentId))
    );
    if (members.length > 1) {
      const tables = [...new Set(members.map((m) => m.table))];
      // דלג אם כבר דווח כ-same_gmail_message מלא (אותם members בדיוק באותה הודעה)
      const sameMsg = members.every((m) => m.gmailMessageId && m.gmailMessageId === members[0].gmailMessageId);
      if (sameMsg && tables.length === 1) continue;
      groups.push({
        reasonCode: "supplier_amount_same_day",
        reason: `אותו ספק+סכום+יום ב-${members.length} רשומות (${tables.join(", ")}) — חשד בלבד: ייתכנו שני חיובים לגיטימיים זהים`,
        members,
      });
    }
  }

  // ---- פלט ----
  console.log(`find-duplicates | ${new Date().toISOString()} | host=${host} | READ-ONLY`);
  console.log(`GmailScanItem=${gsi.length} FinancialDocumentReview=${fdr.length} SupplierPayment=${sp.length} Invoice=${inv.length}`);
  console.log(`\nנמצאו ${groups.length} קבוצות חשודות:\n`);

  const byCode = new Map<string, DuplicateGroup[]>();
  for (const g of groups) byCode.set(g.reasonCode, [...(byCode.get(g.reasonCode) ?? []), g]);
  for (const [code, list] of byCode) {
    console.log(`\n### ${code} — ${list.length} קבוצות`);
    for (const g of list) {
      console.log(`\n  [${g.reasonCode}] ${g.reason}`);
      for (const m of g.members.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
        console.log(fmt(m));
      }
    }
  }
  if (!groups.length) console.log("(לא נמצאו כפילויות חשודות)");
  console.log("\n⚠️  הסקריפט לא מוחק דבר. ניקוי — ידני בלבד, אחרי אימות אנושי של כל קבוצה.");
}

main()
  .catch((err) => {
    console.error("find-duplicates failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
