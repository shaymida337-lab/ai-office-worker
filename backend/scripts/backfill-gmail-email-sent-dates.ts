/**
 * backfill-gmail-email-sent-dates — fix Gmail-scanned docs that incorrectly used today's date
 * (e.g. 2026-08-10) instead of the email's sent timestamp, then re-route complete docs
 * (vendor + amount) to auto_saved / main invoices list.
 *
 * Default: dry-run. Write only with --apply.
 *
 * Usage:
 *   ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/backfill-gmail-email-sent-dates.ts
 *   ALLOW_REMOTE_WRITE=1 npx tsx scripts/backfill-gmail-email-sent-dates.ts --apply
 *   npx tsx scripts/backfill-gmail-email-sent-dates.ts --day=2026-08-10 --apply
 */
import { prisma } from "../src/lib/prisma.js";
import { normalizeBusinessDate } from "../src/services/dates/businessDate.js";
import { isLikelyJunkSupplierName } from "../src/services/supplierNameValidation.js";

const APPLY = process.argv.includes("--apply");
const dayArg = process.argv.find((arg) => arg.startsWith("--day="))?.slice("--day=".length);
const TARGET_DAY = dayArg && /^\d{4}-\d{2}-\d{2}$/.test(dayArg) ? dayArg : "2026-08-10";

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);

if (!isLocal && !APPLY && process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error("🛑 DATABASE_URL is not localhost. For remote dry-run set ALLOW_REMOTE_READONLY_REPORT=1");
  process.exit(1);
}
if (!isLocal && APPLY && process.env.ALLOW_REMOTE_WRITE !== "1") {
  console.error("🛑 --apply against a remote DB requires ALLOW_REMOTE_WRITE=1. Stopping.");
  process.exit(1);
}

console.log(APPLY ? "🔴 APPLY MODE\n" : "🟢 DRY-RUN\n");
console.log(`Target calendar day (UTC date part): ${TARGET_DAY}\n`);

function dayBoundsUtc(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  return { start, end };
}

function sameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

function usableSupplier(name: string | null | undefined): boolean {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return false;
  if (isLikelyJunkSupplierName(cleaned)) return false;
  if (/^(unknown|unknown supplier|לא\s*זוהה|לא\s*ידוע)$/i.test(cleaned)) return false;
  return true;
}

function hasAmount(amount: number | null | undefined): boolean {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

async function main() {
  const { start, end } = dayBoundsUtc(TARGET_DAY);

  const gsiRows = await prisma.gmailScanItem.findMany({
    where: {
      OR: [
        { occurredAt: { gte: start, lte: end } },
        { createdAt: { gte: start, lte: end } },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      gmailMessageId: true,
      emailMessageId: true,
      occurredAt: true,
      amount: true,
      supplierName: true,
      reviewStatus: true,
      driveFileLink: true,
      rawAnalysis: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const emailIds = [...new Set(gsiRows.map((r) => r.emailMessageId).filter(Boolean))] as string[];
  const emails = emailIds.length
    ? await prisma.emailMessage.findMany({
        where: { id: { in: emailIds } },
        select: { id: true, receivedAt: true, gmailId: true },
      })
    : [];
  const emailById = new Map(emails.map((e) => [e.id, e]));

  type GsiFix = {
    id: string;
    organizationId: string;
    fromOccurredAt: Date;
    toOccurredAt: Date;
    promoteAutoSaved: boolean;
    supplierName: string | null;
    amount: number | null;
  };

  const gsiFixes: GsiFix[] = [];
  for (const row of gsiRows) {
    const email = row.emailMessageId ? emailById.get(row.emailMessageId) : null;
    if (!email?.receivedAt || email.receivedAt.getTime() <= 0) continue;
    const emailDate = normalizeBusinessDate(email.receivedAt, null);
    if (!emailDate) continue;
    if (sameUtcDay(row.occurredAt, emailDate)) continue;
    // Only rewrite when the stored day matches the bogus "today" target (or created that day with epoch/today stamp).
    if (!sameUtcDay(row.occurredAt, start) && !(row.occurredAt.getTime() === 0)) continue;

    const promoteAutoSaved =
      usableSupplier(row.supplierName) &&
      hasAmount(row.amount) &&
      row.reviewStatus !== "auto_saved" &&
      row.reviewStatus !== "approved" &&
      row.reviewStatus !== "rejected";

    gsiFixes.push({
      id: row.id,
      organizationId: row.organizationId,
      fromOccurredAt: row.occurredAt,
      toOccurredAt: emailDate,
      promoteAutoSaved,
      supplierName: row.supplierName,
      amount: row.amount,
    });
  }

  const fdrRows = await prisma.financialDocumentReview.findMany({
    where: {
      source: "gmail",
      OR: [
        { documentDate: { gte: start, lte: end } },
        { documentDate: null, createdAt: { gte: start, lte: end } },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      emailMessageId: true,
      gmailMessageId: true,
      documentDate: true,
      totalAmount: true,
      supplierName: true,
      reviewStatus: true,
      driveFileUrl: true,
      rawAnalysis: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const fdrEmailIds = [...new Set(fdrRows.map((r) => r.emailMessageId).filter(Boolean))] as string[];
  const fdrEmails = fdrEmailIds.length
    ? await prisma.emailMessage.findMany({
        where: { id: { in: fdrEmailIds } },
        select: { id: true, receivedAt: true },
      })
    : [];
  const fdrEmailById = new Map(fdrEmails.map((e) => [e.id, e]));

  type FdrFix = {
    id: string;
    fromDate: Date | null;
    toDate: Date;
    promoteAutoSaved: boolean;
  };
  const fdrFixes: FdrFix[] = [];
  for (const row of fdrRows) {
    const email = row.emailMessageId ? fdrEmailById.get(row.emailMessageId) : null;
    if (!email?.receivedAt || email.receivedAt.getTime() <= 0) continue;
    const emailDate = normalizeBusinessDate(email.receivedAt, null);
    if (!emailDate) continue;
    if (row.documentDate && sameUtcDay(row.documentDate, emailDate)) continue;
    if (row.documentDate && !sameUtcDay(row.documentDate, start)) continue;

    const promoteAutoSaved =
      usableSupplier(row.supplierName) &&
      hasAmount(row.totalAmount) &&
      row.reviewStatus !== "auto_saved" &&
      row.reviewStatus !== "approved" &&
      row.reviewStatus !== "rejected";

    fdrFixes.push({
      id: row.id,
      fromDate: row.documentDate,
      toDate: emailDate,
      promoteAutoSaved,
    });
  }

  const invoiceRows = await prisma.invoice.findMany({
    where: {
      date: { gte: start, lte: end },
      gmailMessageId: { not: null },
    },
    select: {
      id: true,
      organizationId: true,
      gmailMessageId: true,
      date: true,
      amount: true,
      supplierName: true,
      status: true,
    },
  });

  type InvoiceFix = { id: string; fromDate: Date; toDate: Date };
  const invoiceFixes: InvoiceFix[] = [];
  for (const row of invoiceRows) {
    if (!row.gmailMessageId) continue;
    const email = await prisma.emailMessage.findFirst({
      where: { organizationId: row.organizationId, gmailId: row.gmailMessageId },
      select: { receivedAt: true },
    });
    if (!email?.receivedAt || email.receivedAt.getTime() <= 0) continue;
    const emailDate = normalizeBusinessDate(email.receivedAt, null);
    if (!emailDate || sameUtcDay(row.date, emailDate)) continue;
    invoiceFixes.push({ id: row.id, fromDate: row.date, toDate: emailDate });
  }

  console.log("=".repeat(72));
  console.log(`GmailScanItem date fixes: ${gsiFixes.length}`);
  for (const fix of gsiFixes.slice(0, 50)) {
    console.log(
      `  ${fix.id} | ${fix.fromOccurredAt.toISOString()} -> ${fix.toOccurredAt.toISOString()}` +
        (fix.promoteAutoSaved ? " | promote auto_saved" : "")
    );
  }
  if (gsiFixes.length > 50) console.log(`  ... +${gsiFixes.length - 50} more`);

  console.log("\n" + "=".repeat(72));
  console.log(`FinancialDocumentReview date fixes: ${fdrFixes.length}`);
  for (const fix of fdrFixes.slice(0, 50)) {
    console.log(
      `  ${fix.id} | ${fix.fromDate?.toISOString() ?? "null"} -> ${fix.toDate.toISOString()}` +
        (fix.promoteAutoSaved ? " | promote auto_saved" : "")
    );
  }
  if (fdrFixes.length > 50) console.log(`  ... +${fdrFixes.length - 50} more`);

  console.log("\n" + "=".repeat(72));
  console.log(`Invoice date fixes: ${invoiceFixes.length}`);
  for (const fix of invoiceFixes.slice(0, 50)) {
    console.log(`  ${fix.id} | ${fix.fromDate.toISOString()} -> ${fix.toDate.toISOString()}`);
  }
  if (invoiceFixes.length > 50) console.log(`  ... +${invoiceFixes.length - 50} more`);

  if (!APPLY) {
    console.log("\n🟢 DRY-RUN done — nothing written. Re-run with --apply to update.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const fix of gsiFixes) {
      const raw = await tx.gmailScanItem.findUnique({
        where: { id: fix.id },
        select: { rawAnalysis: true },
      });
      const rawAnalysis =
        raw?.rawAnalysis && typeof raw.rawAnalysis === "object" && !Array.isArray(raw.rawAnalysis)
          ? { ...(raw.rawAnalysis as Record<string, unknown>) }
          : {};
      rawAnalysis.invoiceDate = fix.toOccurredAt.toISOString();
      rawAnalysis.invoiceDateSource = "email_sent";

      await tx.gmailScanItem.update({
        where: { id: fix.id },
        data: {
          occurredAt: fix.toOccurredAt,
          ...(fix.promoteAutoSaved
            ? {
                reviewStatus: "auto_saved",
                decisionReason: "Backfill: vendor+amount complete; date set from email sent time",
              }
            : {}),
          rawAnalysis,
        },
      });
    }

    for (const fix of fdrFixes) {
      await tx.financialDocumentReview.update({
        where: { id: fix.id },
        data: {
          documentDate: fix.toDate,
          normalizedDocumentDate: fix.toDate,
          ...(fix.promoteAutoSaved
            ? {
                reviewStatus: "auto_saved",
                uncertaintyReason: null,
              }
            : {}),
        },
      });
    }

    for (const fix of invoiceFixes) {
      await tx.invoice.update({
        where: { id: fix.id },
        data: {
          date: fix.toDate,
          normalizedDocumentDate: fix.toDate,
        },
      });
    }
  });

  console.log(
    `\n✅ Applied: gsi=${gsiFixes.length} fdr=${fdrFixes.length} invoices=${invoiceFixes.length}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
