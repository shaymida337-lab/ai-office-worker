/**
 * backfill-gmail-email-sent-dates — fix Gmail-scanned docs that incorrectly used
 * ingest-time / "today" (e.g. Date.now()) instead of the email's sent timestamp,
 * then re-route complete docs (vendor + amount + date) to auto_saved / main invoices.
 *
 * Default: dry-run over ALL linked records (no day filter). Write only with --apply.
 *
 * Usage:
 *   ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/backfill-gmail-email-sent-dates.ts
 *   ALLOW_REMOTE_READONLY_REPORT=1 npx tsx scripts/backfill-gmail-email-sent-dates.ts --all
 *   ALLOW_REMOTE_WRITE=1 npx tsx scripts/backfill-gmail-email-sent-dates.ts --apply
 *   npx tsx scripts/backfill-gmail-email-sent-dates.ts --day=2026-08-10 --apply
 *
 * Flags:
 *   --all          Scan every Gmail-linked row (default when --day is omitted)
 *   --day=YYYY-MM-DD  Only rewrite rows whose stored document date falls on this UTC day
 *   --apply        Persist updates (default is dry-run)
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { normalizeBusinessDate } from "../src/services/dates/businessDate.js";
import { isLikelyJunkSupplierName } from "../src/services/supplierNameValidation.js";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const dayArg = process.argv.find((arg) => arg.startsWith("--day="))?.slice("--day=".length);
const DAY_FILTER = dayArg && /^\d{4}-\d{2}-\d{2}$/.test(dayArg) ? dayArg : null;

if (ALL && DAY_FILTER) {
  console.error("🛑 Use either --all or --day=YYYY-MM-DD, not both.");
  process.exit(1);
}

/** Unconstrained by default; --day narrows which *stored* dates are eligible for rewrite. */
const SCAN_ALL = !DAY_FILTER;

const RUN_TODAY_UTC = new Date().toISOString().slice(0, 10);

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
if (SCAN_ALL) {
  console.log("Scope: ALL Gmail-linked records with email receivedAt / internalDate\n");
} else {
  console.log(`Scope: stored document dates on UTC day ${DAY_FILTER}\n`);
}
console.log(`Script run UTC day (for now()/today detection): ${RUN_TODAY_UTC}\n`);

function dayBoundsUtc(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  return { start, end };
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sameUtcDay(a: Date, b: Date): boolean {
  return utcDay(a) === utcDay(b);
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

/**
 * True when the stored date looks like an ingest-time / "today" stamp rather than
 * a real document or email-sent date.
 *
 * Deliberately does NOT treat "same calendar day as createdAt" alone as bogus —
 * date-only OCR often lands on T00:00:00 UTC the same day the email was scanned.
 */
function looksLikeBogusNowStamp(stored: Date | null | undefined, createdAt: Date): boolean {
  if (!stored || !Number.isFinite(stored.getTime())) return true;
  if (stored.getTime() === 0) return true;
  // Explicitly catch "today" as of script run (e.g. 2026-08-10).
  if (utcDay(stored) === RUN_TODAY_UTC) return true;
  // Exact/near ingest-time stamp (Date.now() at save), not a date-only OCR day.
  const deltaMs = Math.abs(stored.getTime() - createdAt.getTime());
  if (deltaMs <= 5 * 60 * 1000) return true;
  return false;
}

function invoiceDateSourceFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = (raw as Record<string, unknown>).invoiceDateSource;
  return typeof source === "string" ? source.trim().toLowerCase() : null;
}

function shouldRewriteStoredDate(input: {
  stored: Date | null | undefined;
  emailDate: Date;
  createdAt: Date;
  rawAnalysis?: unknown;
}): boolean {
  const { stored, emailDate, createdAt, rawAnalysis } = input;
  if (stored && sameUtcDay(stored, emailDate)) return false;

  // Preserve explicit OCR/AI document dates — only rewrite ingest/"today" stamps.
  if (invoiceDateSourceFromRaw(rawAnalysis) === "document") return false;

  if (DAY_FILTER) {
    if (!stored) return true; // null date on filtered day scope via createdAt query
    return utcDay(stored) === DAY_FILTER;
  }

  return looksLikeBogusNowStamp(stored, createdAt);
}

function shouldPromote(input: {
  supplierName: string | null | undefined;
  amount: number | null | undefined;
  reviewStatus: string | null | undefined;
  hasValidDate: boolean;
}): boolean {
  if (!input.hasValidDate) return false;
  if (!usableSupplier(input.supplierName) || !hasAmount(input.amount)) return false;
  const status = (input.reviewStatus ?? "").trim().toLowerCase();
  if (status === "auto_saved" || status === "approved" || status === "rejected") return false;
  return true;
}

async function main() {
  const dayBounds = DAY_FILTER ? dayBoundsUtc(DAY_FILTER) : null;

  const gsiWhere = dayBounds
    ? {
        OR: [
          { occurredAt: { gte: dayBounds.start, lte: dayBounds.end } },
          { createdAt: { gte: dayBounds.start, lte: dayBounds.end } },
        ],
      }
    : {
        // All rows that can resolve an email sent time via EmailMessage.
        OR: [{ emailMessageId: { not: null } }, { gmailMessageId: { not: "" } }],
      };

  const gsiRows = await prisma.gmailScanItem.findMany({
    where: gsiWhere,
    select: {
      id: true,
      organizationId: true,
      gmailMessageId: true,
      emailMessageId: true,
      occurredAt: true,
      amount: true,
      supplierName: true,
      reviewStatus: true,
      rawAnalysis: true,
      createdAt: true,
      normalizedDocumentDate: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const emailIds = [...new Set(gsiRows.map((r) => r.emailMessageId).filter(Boolean))] as string[];
  const gmailIds = [...new Set(gsiRows.map((r) => r.gmailMessageId).filter(Boolean))];

  const emailsByIdRows = emailIds.length
    ? await prisma.emailMessage.findMany({
        where: { id: { in: emailIds } },
        select: { id: true, receivedAt: true, gmailId: true, organizationId: true },
      })
    : [];
  const emailById = new Map(emailsByIdRows.map((e) => [e.id, e]));

  const emailsByGmailRows = gmailIds.length
    ? await prisma.emailMessage.findMany({
        where: { gmailId: { in: gmailIds } },
        select: { id: true, receivedAt: true, gmailId: true, organizationId: true },
      })
    : [];
  const emailByOrgGmail = new Map(
    emailsByGmailRows.map((e) => [`${e.organizationId}:${e.gmailId}`, e])
  );

  type GsiFix = {
    id: string;
    organizationId: string;
    fromOccurredAt: Date;
    toOccurredAt: Date;
    dateChanged: boolean;
    promoteAutoSaved: boolean;
    supplierName: string | null;
    amount: number | null;
  };

  const gsiFixes: GsiFix[] = [];
  const gsiByEmailDay = new Map<string, number>();

  for (const row of gsiRows) {
    const email =
      (row.emailMessageId ? emailById.get(row.emailMessageId) : null) ??
      emailByOrgGmail.get(`${row.organizationId}:${row.gmailMessageId}`) ??
      null;
    if (!email?.receivedAt || email.receivedAt.getTime() <= 0) continue;
    const emailDate = normalizeBusinessDate(email.receivedAt, null);
    if (!emailDate) continue;

    const dateChanged = shouldRewriteStoredDate({
      stored: row.occurredAt,
      emailDate,
      createdAt: row.createdAt,
      rawAnalysis: row.rawAnalysis,
    });
    if (!dateChanged) continue;

    const promoteAutoSaved = shouldPromote({
      supplierName: row.supplierName,
      amount: row.amount,
      reviewStatus: row.reviewStatus,
      hasValidDate: true,
    });

    gsiFixes.push({
      id: row.id,
      organizationId: row.organizationId,
      fromOccurredAt: row.occurredAt,
      toOccurredAt: emailDate,
      dateChanged: true,
      promoteAutoSaved,
      supplierName: row.supplierName,
      amount: row.amount,
    });

    const key = utcDay(emailDate);
    gsiByEmailDay.set(key, (gsiByEmailDay.get(key) ?? 0) + 1);
  }

  const fdrWhere = dayBounds
    ? {
        source: "gmail",
        OR: [
          { documentDate: { gte: dayBounds.start, lte: dayBounds.end } },
          { documentDate: null, createdAt: { gte: dayBounds.start, lte: dayBounds.end } },
        ],
      }
    : {
        source: "gmail",
        OR: [{ emailMessageId: { not: null } }, { gmailMessageId: { not: null } }],
      };

  const fdrRows = await prisma.financialDocumentReview.findMany({
    where: fdrWhere,
    select: {
      id: true,
      organizationId: true,
      emailMessageId: true,
      gmailMessageId: true,
      documentDate: true,
      totalAmount: true,
      supplierName: true,
      reviewStatus: true,
      createdAt: true,
      rawAnalysis: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const fdrEmailIds = [...new Set(fdrRows.map((r) => r.emailMessageId).filter(Boolean))] as string[];
  const fdrGmailIds = [...new Set(fdrRows.map((r) => r.gmailMessageId).filter(Boolean))] as string[];

  const fdrEmails = fdrEmailIds.length
    ? await prisma.emailMessage.findMany({
        where: { id: { in: fdrEmailIds } },
        select: { id: true, receivedAt: true, gmailId: true, organizationId: true },
      })
    : [];
  const fdrEmailById = new Map(fdrEmails.map((e) => [e.id, e]));

  const fdrEmailsByGmail = fdrGmailIds.length
    ? await prisma.emailMessage.findMany({
        where: { gmailId: { in: fdrGmailIds } },
        select: { id: true, receivedAt: true, gmailId: true, organizationId: true },
      })
    : [];
  const fdrEmailByOrgGmail = new Map(
    fdrEmailsByGmail.map((e) => [`${e.organizationId}:${e.gmailId}`, e])
  );

  type FdrFix = {
    id: string;
    fromDate: Date | null;
    toDate: Date;
    dateChanged: boolean;
    promoteAutoSaved: boolean;
  };
  const fdrFixes: FdrFix[] = [];
  const fdrByEmailDay = new Map<string, number>();

  for (const row of fdrRows) {
    const email =
      (row.emailMessageId ? fdrEmailById.get(row.emailMessageId) : null) ??
      (row.gmailMessageId
        ? fdrEmailByOrgGmail.get(`${row.organizationId}:${row.gmailMessageId}`)
        : null) ??
      null;
    if (!email?.receivedAt || email.receivedAt.getTime() <= 0) continue;
    const emailDate = normalizeBusinessDate(email.receivedAt, null);
    if (!emailDate) continue;

    const dateChanged = shouldRewriteStoredDate({
      stored: row.documentDate,
      emailDate,
      createdAt: row.createdAt,
      rawAnalysis: row.rawAnalysis,
    });
    if (!dateChanged) continue;

    const promoteAutoSaved = shouldPromote({
      supplierName: row.supplierName,
      amount: row.totalAmount,
      reviewStatus: row.reviewStatus,
      hasValidDate: true,
    });

    fdrFixes.push({
      id: row.id,
      fromDate: row.documentDate,
      toDate: emailDate,
      dateChanged: true,
      promoteAutoSaved,
    });

    const key = utcDay(emailDate);
    fdrByEmailDay.set(key, (fdrByEmailDay.get(key) ?? 0) + 1);
  }

  const invoiceWhere = dayBounds
    ? {
        date: { gte: dayBounds.start, lte: dayBounds.end },
        gmailMessageId: { not: null },
      }
    : {
        gmailMessageId: { not: null },
      };

  const invoiceRows = await prisma.invoice.findMany({
    where: invoiceWhere,
    select: {
      id: true,
      organizationId: true,
      gmailMessageId: true,
      date: true,
      createdAt: true,
    },
  });

  const invoiceGmailIds = [
    ...new Set(invoiceRows.map((r) => r.gmailMessageId).filter(Boolean)),
  ] as string[];
  const invoiceEmails = invoiceGmailIds.length
    ? await prisma.emailMessage.findMany({
        where: { gmailId: { in: invoiceGmailIds } },
        select: { receivedAt: true, gmailId: true, organizationId: true },
      })
    : [];
  const invoiceEmailByOrgGmail = new Map(
    invoiceEmails.map((e) => [`${e.organizationId}:${e.gmailId}`, e])
  );

  type InvoiceFix = { id: string; fromDate: Date; toDate: Date };
  const invoiceFixes: InvoiceFix[] = [];
  const invoiceByEmailDay = new Map<string, number>();

  for (const row of invoiceRows) {
    if (!row.gmailMessageId) continue;
    const email = invoiceEmailByOrgGmail.get(`${row.organizationId}:${row.gmailMessageId}`);
    if (!email?.receivedAt || email.receivedAt.getTime() <= 0) continue;
    const emailDate = normalizeBusinessDate(email.receivedAt, null);
    if (!emailDate) continue;
    if (!shouldRewriteStoredDate({ stored: row.date, emailDate, createdAt: row.createdAt })) {
      continue;
    }
    invoiceFixes.push({ id: row.id, fromDate: row.date, toDate: emailDate });
    const key = utcDay(emailDate);
    invoiceByEmailDay.set(key, (invoiceByEmailDay.get(key) ?? 0) + 1);
  }

  const gsiDateFixes = gsiFixes.filter((f) => f.dateChanged).length;
  const gsiPromotes = gsiFixes.filter((f) => f.promoteAutoSaved).length;
  const fdrDateFixes = fdrFixes.filter((f) => f.dateChanged).length;
  const fdrPromotes = fdrFixes.filter((f) => f.promoteAutoSaved).length;

  console.log("=".repeat(72));
  console.log(
    `GmailScanItem: ${gsiFixes.length} updates (${gsiDateFixes} date fixes, ${gsiPromotes} → auto_saved) — scanned ${gsiRows.length}`
  );
  for (const fix of gsiFixes.slice(0, 50)) {
    const parts = [
      fix.id,
      fix.dateChanged
        ? `${fix.fromOccurredAt.toISOString()} -> ${fix.toOccurredAt.toISOString()}`
        : "date ok",
      fix.promoteAutoSaved ? "promote auto_saved" : null,
    ].filter(Boolean);
    console.log(`  ${parts.join(" | ")}`);
  }
  if (gsiFixes.length > 50) console.log(`  ... +${gsiFixes.length - 50} more`);

  console.log("\n" + "=".repeat(72));
  console.log(
    `FinancialDocumentReview: ${fdrFixes.length} updates (${fdrDateFixes} date fixes, ${fdrPromotes} → auto_saved) — scanned ${fdrRows.length}`
  );
  for (const fix of fdrFixes.slice(0, 50)) {
    const parts = [
      fix.id,
      fix.dateChanged
        ? `${fix.fromDate?.toISOString() ?? "null"} -> ${fix.toDate.toISOString()}`
        : "date ok",
      fix.promoteAutoSaved ? "promote auto_saved" : null,
    ].filter(Boolean);
    console.log(`  ${parts.join(" | ")}`);
  }
  if (fdrFixes.length > 50) console.log(`  ... +${fdrFixes.length - 50} more`);

  console.log("\n" + "=".repeat(72));
  console.log(`Invoice date fixes: ${invoiceFixes.length} — scanned ${invoiceRows.length}`);
  for (const fix of invoiceFixes.slice(0, 50)) {
    console.log(`  ${fix.id} | ${fix.fromDate.toISOString()} -> ${fix.toDate.toISOString()}`);
  }
  if (invoiceFixes.length > 50) console.log(`  ... +${invoiceFixes.length - 50} more`);

  const printDayBreakdown = (label: string, map: Map<string, number>) => {
    if (map.size === 0) return;
    console.log(`\n${label} by destination email UTC day:`);
    for (const [day, count] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${day}: ${count}`);
    }
  };
  printDayBreakdown("GmailScanItem date fixes", gsiByEmailDay);
  printDayBreakdown("FinancialDocumentReview date fixes", fdrByEmailDay);
  printDayBreakdown("Invoice date fixes", invoiceByEmailDay);

  console.log("\n" + "=".repeat(72));
  console.log(
    `TOTAL: gsi=${gsiFixes.length} fdr=${fdrFixes.length} invoices=${invoiceFixes.length}` +
      ` | dateFixes=${gsiDateFixes + fdrDateFixes + invoiceFixes.length}` +
      ` | promotes=${gsiPromotes + fdrPromotes}`
  );

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
      if (fix.dateChanged) {
        rawAnalysis.invoiceDate = fix.toOccurredAt.toISOString();
        rawAnalysis.invoiceDateSource = "email_sent";
      }

      await tx.gmailScanItem.update({
        where: { id: fix.id },
        data: {
          ...(fix.dateChanged
            ? {
                occurredAt: fix.toOccurredAt,
                normalizedDocumentDate: fix.toOccurredAt,
                rawAnalysis,
              }
            : {}),
          ...(fix.promoteAutoSaved
            ? {
                reviewStatus: "auto_saved",
                decisionReason: "Backfill: vendor+amount complete; date set from email sent time",
              }
            : {}),
        },
      });
    }

    for (const fix of fdrFixes) {
      await tx.financialDocumentReview.update({
        where: { id: fix.id },
        data: {
          ...(fix.dateChanged
            ? {
                documentDate: fix.toDate,
                normalizedDocumentDate: fix.toDate,
              }
            : {}),
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
