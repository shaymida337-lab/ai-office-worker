/**
 * DRY-RUN audit only — read-only. No create/update/delete/upsert.
 * Run: cd backend && npx tsx scripts/audit-invoice-junk.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { isLikelyJunkSupplierName } from "../src/services/supplierNameValidation.js";
import {
  classifyReprocessSourceCapability,
  loadEmailGmailIdMap,
  type ReprocessSourceCapability,
} from "../src/services/reprocessFinancialDocument.js";

const auditPrisma = new PrismaClient({ log: [] });

const MILLION = 1_000_000;
const SAMPLE_LIMIT = 10;

type Category = "junk_supplier" | "million" | "zero_amount";
type TableName = "GmailScanItem" | "Invoice" | "FinancialDocumentReview";

type AuditRow = {
  table: TableName;
  id: string;
  organizationId: string;
  supplierName: string | null;
  amount: number | null;
  date: Date | null;
  reviewStatus: string | null;
  gmailMessageId: string | null;
  emailMessageId: string | null;
  hasSource: boolean;
  sourceDetail: string;
  categories: Category[];
};

const columnCache = new Map<string, Set<string>>();

function isMillionAmount(amount: number | null | undefined) {
  return amount != null && Number.isFinite(amount) && amount === MILLION;
}

function isZeroOrMissingAmount(amount: number | null | undefined) {
  return amount == null || amount === 0;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const converted = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(converted) ? converted : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function classifyCategories(input: {
  supplierName: string | null | undefined;
  amount: number | null | undefined;
}): Category[] {
  const categories: Category[] = [];
  const supplier = input.supplierName?.trim() ?? "";
  if (supplier && isLikelyJunkSupplierName(supplier)) categories.push("junk_supplier");
  if (isMillionAmount(input.amount ?? null)) categories.push("million");
  if (isZeroOrMissingAmount(input.amount ?? null)) categories.push("zero_amount");
  return categories;
}

function buildSourceDetail(input: {
  gmailMessageId?: string | null;
  emailMessageId?: string | null;
  attachmentFilename?: string | null;
  fileName?: string | null;
  driveFileUrl?: string | null;
  driveFileLink?: string | null;
  driveUrl?: string | null;
  attachmentCount?: number;
}) {
  const parts: string[] = [];
  if (input.gmailMessageId) parts.push(`gmailMessageId=${input.gmailMessageId}`);
  if (input.emailMessageId) parts.push(`emailMessageId=${input.emailMessageId}`);
  if (input.attachmentFilename) parts.push(`attachment=${input.attachmentFilename}`);
  else if (input.fileName) parts.push(`fileName=${input.fileName}`);
  if (input.driveFileUrl || input.driveFileLink || input.driveUrl) parts.push("driveLink=yes");
  if (input.attachmentCount != null && input.attachmentCount > 0) {
    parts.push(`emailAttachments=${input.attachmentCount}`);
  }
  const hasSource = parts.length > 0;
  return {
    hasSource,
    sourceDetail: hasSource ? parts.join(" | ") : "orphan (no gmail/email/drive/file)",
  };
}

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "—";
}

function printSample(rows: AuditRow[], category: Category, table: TableName) {
  const filtered = rows.filter((row) => row.table === table && row.categories.includes(category));
  console.log(`\n  [${table}] ${categoryLabel(category)} — sample (${Math.min(filtered.length, SAMPLE_LIMIT)} of ${filtered.length})`);
  if (!filtered.length) {
    console.log("    (none)");
    return;
  }
  for (const row of filtered.slice(0, SAMPLE_LIMIT)) {
    console.log(
      `    id=${row.id} org=${row.organizationId} supplier="${row.supplierName ?? "—"}" amount=${row.amount ?? "null"} date=${formatDate(row.date)} review=${row.reviewStatus ?? "—"} source=${row.hasSource ? "yes" : "ORPHAN"} (${row.sourceDetail})`
    );
  }
}

function categoryLabel(category: Category) {
  switch (category) {
    case "junk_supplier":
      return "junk supplierName";
    case "million":
      return "amount exactly 1,000,000";
    case "zero_amount":
      return "amount 0 or null";
  }
}

async function getTableColumns(table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;

  const rows = await auditPrisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  const columns = new Set(rows.map((row) => row.column_name));
  columnCache.set(table, columns);
  return columns;
}

function colOrNull(columns: Set<string>, name: string, pgType: string) {
  return columns.has(name) ? `"${name}"` : `NULL::${pgType}`;
}

async function attachmentCountByEmailMessageId(emailMessageIds: string[]) {
  const counts = new Map<string, number>();
  if (!emailMessageIds.length) return counts;
  const attachments = await auditPrisma.emailAttachment.findMany({
    where: { emailMessageId: { in: emailMessageIds } },
    select: { emailMessageId: true },
  });
  for (const attachment of attachments) {
    counts.set(attachment.emailMessageId, (counts.get(attachment.emailMessageId) ?? 0) + 1);
  }
  return counts;
}

async function safeLoad<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[audit] Warning: could not load ${label} — ${message.split("\n")[0]}`);
    return fallback;
  }
}

async function loadGmailScanItems(): Promise<AuditRow[]> {
  const columns = await getTableColumns("GmailScanItem");
  if (!columns.size) {
    console.warn("[audit] Warning: GmailScanItem table not found — skipping");
    return [];
  }

  const rows = await auditPrisma.gmailScanItem.findMany({
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      amount: true,
      occurredAt: true,
      reviewStatus: true,
      gmailMessageId: true,
      emailMessageId: true,
      attachmentFilename: true,
      driveFileLink: true,
    },
  });
  const emailIds = rows.map((row) => row.emailMessageId).filter((id): id is string => Boolean(id));
  const attachmentCounts = await attachmentCountByEmailMessageId(emailIds);

  return rows.flatMap((row) => {
    const categories = classifyCategories({ supplierName: row.supplierName, amount: row.amount });
    if (!categories.length) return [];
    const source = buildSourceDetail({
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailMessageId,
      attachmentFilename: row.attachmentFilename,
      driveFileLink: row.driveFileLink,
      attachmentCount: row.emailMessageId ? attachmentCounts.get(row.emailMessageId) ?? 0 : 0,
    });
    return [{
      table: "GmailScanItem" as const,
      id: row.id,
      organizationId: row.organizationId,
      supplierName: row.supplierName,
      amount: row.amount,
      date: row.occurredAt,
      reviewStatus: row.reviewStatus,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailMessageId,
      hasSource: source.hasSource,
      sourceDetail: source.sourceDetail,
      categories,
    }];
  });
}

type RawInvoiceRow = {
  id: string;
  organizationId: string;
  supplierName: string | null;
  amount: unknown;
  date: unknown;
  status: string;
  gmailMessageId: string | null;
  emailId: string | null;
  driveFileUrl: string | null;
  driveUrl: string | null;
};

function mapInvoiceRows(rows: RawInvoiceRow[]): AuditRow[] {
  return rows.flatMap((row) => {
    const amount = toNumber(row.amount);
    const categories = classifyCategories({ supplierName: row.supplierName, amount });
    if (!categories.length) return [];
    const source = buildSourceDetail({
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailId,
      driveFileUrl: row.driveFileUrl ?? row.driveUrl,
    });
    return [{
      table: "Invoice" as const,
      id: row.id,
      organizationId: row.organizationId,
      supplierName: row.supplierName,
      amount,
      date: toDate(row.date),
      reviewStatus: row.status,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailId,
      hasSource: source.hasSource,
      sourceDetail: source.sourceDetail,
      categories,
    }];
  });
}

async function loadInvoicesFromPrisma(): Promise<AuditRow[]> {
  const rows = await auditPrisma.invoice.findMany({
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      amount: true,
      date: true,
      status: true,
      gmailMessageId: true,
      emailId: true,
      driveFileUrl: true,
      driveUrl: true,
    },
  });
  return mapInvoiceRows(rows);
}

async function loadInvoicesFromRawSql(): Promise<AuditRow[]> {
  const columns = await getTableColumns("Invoice");
  if (!columns.size) return [];

  const driveSelect = columns.has("driveFileUrl")
    ? `"driveFileUrl"`
    : columns.has("driveUrl")
      ? `"driveUrl"`
      : "NULL::text";

  const rows = await auditPrisma.$queryRawUnsafe<RawInvoiceRow[]>(`
    SELECT
      id,
      "organizationId",
      ${colOrNull(columns, "supplierName", "text")} AS "supplierName",
      amount,
      date,
      status,
      ${colOrNull(columns, "gmailMessageId", "text")} AS "gmailMessageId",
      ${colOrNull(columns, "emailId", "text")} AS "emailId",
      ${driveSelect} AS "driveFileUrl",
      ${colOrNull(columns, "driveUrl", "text")} AS "driveUrl"
    FROM "Invoice"
  `);
  return mapInvoiceRows(rows);
}

async function loadInvoices(): Promise<AuditRow[]> {
  const columns = await getTableColumns("Invoice");
  if (!columns.size) {
    console.warn("[audit] Warning: Invoice table not found — skipping");
    return [];
  }

  if (columns.has("supplierName") && columns.has("driveFileUrl")) {
    try {
      return await loadInvoicesFromPrisma();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[audit] Warning: Invoice prisma load failed — ${message.split("\n")[0]}`);
    }
  } else {
    const missing = [
      !columns.has("supplierName") ? "supplierName" : null,
      !columns.has("driveFileUrl") && !columns.has("driveUrl") ? "driveFileUrl/driveUrl" : null,
    ].filter(Boolean);
    console.warn(`[audit] Warning: Invoice schema drift (${missing.join(", ")}) — using raw SQL fallback`);
  }

  return loadInvoicesFromRawSql();
}

type RawReviewRow = {
  id: string;
  organizationId: string;
  supplierName: string | null;
  totalAmount: unknown;
  documentDate: unknown;
  reviewStatus: string;
  gmailMessageId: string | null;
  emailMessageId: string | null;
  fileName: string | null;
  driveFileUrl: string | null;
};

function mapReviewRows(rows: RawReviewRow[], attachmentCounts: Map<string, number>): AuditRow[] {
  return rows.flatMap((row) => {
    const amount = toNumber(row.totalAmount);
    const categories = classifyCategories({ supplierName: row.supplierName, amount });
    if (!categories.length) return [];
    const source = buildSourceDetail({
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailMessageId,
      fileName: row.fileName,
      driveFileUrl: row.driveFileUrl,
      attachmentCount: row.emailMessageId ? attachmentCounts.get(row.emailMessageId) ?? 0 : 0,
    });
    return [{
      table: "FinancialDocumentReview" as const,
      id: row.id,
      organizationId: row.organizationId,
      supplierName: row.supplierName,
      amount,
      date: toDate(row.documentDate),
      reviewStatus: row.reviewStatus,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailMessageId,
      hasSource: source.hasSource,
      sourceDetail: source.sourceDetail,
      categories,
    }];
  });
}

async function loadFinancialDocumentReviewsFromPrisma(): Promise<AuditRow[]> {
  const rows = await auditPrisma.financialDocumentReview.findMany({
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      totalAmount: true,
      documentDate: true,
      reviewStatus: true,
      gmailMessageId: true,
      emailMessageId: true,
      fileName: true,
      driveFileUrl: true,
    },
  });
  const emailIds = rows.map((row) => row.emailMessageId).filter((id): id is string => Boolean(id));
  const attachmentCounts = await attachmentCountByEmailMessageId(emailIds);
  return mapReviewRows(rows, attachmentCounts);
}

async function loadFinancialDocumentReviewsFromRawSql(): Promise<AuditRow[]> {
  const columns = await getTableColumns("FinancialDocumentReview");
  if (!columns.size) return [];

  const rows = await auditPrisma.$queryRawUnsafe<RawReviewRow[]>(`
    SELECT
      id,
      "organizationId",
      ${colOrNull(columns, "supplierName", "text")} AS "supplierName",
      ${colOrNull(columns, "totalAmount", "double precision")} AS "totalAmount",
      ${colOrNull(columns, "documentDate", "timestamp")} AS "documentDate",
      ${colOrNull(columns, "reviewStatus", "text")} AS "reviewStatus",
      ${colOrNull(columns, "gmailMessageId", "text")} AS "gmailMessageId",
      ${colOrNull(columns, "emailMessageId", "text")} AS "emailMessageId",
      ${colOrNull(columns, "fileName", "text")} AS "fileName",
      ${colOrNull(columns, "driveFileUrl", "text")} AS "driveFileUrl"
    FROM "FinancialDocumentReview"
  `);
  const emailIds = rows.map((row) => row.emailMessageId).filter((id): id is string => Boolean(id));
  const attachmentCounts = await attachmentCountByEmailMessageId(emailIds);
  return mapReviewRows(rows, attachmentCounts);
}

async function loadFinancialDocumentReviews(): Promise<AuditRow[]> {
  const columns = await getTableColumns("FinancialDocumentReview");
  if (!columns.size) {
    console.warn("[audit] Warning: FinancialDocumentReview table not found — skipping");
    return [];
  }

  try {
    return await loadFinancialDocumentReviewsFromPrisma();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[audit] Warning: FinancialDocumentReview prisma load failed — ${message.split("\n")[0]}`);
    return loadFinancialDocumentReviewsFromRawSql();
  }
}

function countByTableAndCategory(rows: AuditRow[]) {
  const tables: TableName[] = ["GmailScanItem", "Invoice", "FinancialDocumentReview"];
  const categories: Category[] = ["junk_supplier", "million", "zero_amount"];
  const counts = new Map<string, number>();
  for (const table of tables) {
    for (const category of categories) {
      counts.set(`${table}:${category}`, 0);
    }
  }
  for (const row of rows) {
    for (const category of row.categories) {
      const key = `${row.table}:${category}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function printSummary(counts: Map<string, number>) {
  console.log("\n=== Summary (counts per table × category) ===");
  console.log("Note: one row may appear in multiple categories.\n");
  for (const table of ["GmailScanItem", "Invoice", "FinancialDocumentReview"] as const) {
    console.log(`--- ${table} ---`);
    for (const category of ["junk_supplier", "million", "zero_amount"] as const) {
      console.log(`  ${categoryLabel(category)}: ${counts.get(`${table}:${category}`) ?? 0}`);
    }
  }
}

function printRecommendation(rows: AuditRow[]) {
  const uniqueKeys = new Set<string>();
  const flagged: AuditRow[] = [];
  for (const row of rows) {
    const key = `${row.table}:${row.id}`;
    if (uniqueKeys.has(key)) continue;
    uniqueKeys.add(key);
    flagged.push(row);
  }

  const orphans = flagged.filter((row) => !row.hasSource);
  const withSource = flagged.filter((row) => row.hasSource);
  const clearJunkOrphans = orphans.filter((row) => row.categories.includes("junk_supplier"));

  console.log("\n=== Recommendation (DRY-RUN — no changes made) ===");
  console.log(`Total distinct flagged records (any category): ${flagged.length}`);
  console.log(`  With recoverable source (gmail/email/drive/file): ${withSource.length} → candidate for re-sync / re-parse`);
  console.log(`  Orphans (no source link): ${orphans.length}`);
  console.log(`  Orphans with junk supplierName: ${clearJunkOrphans.length} → safest delete candidates if you clean up`);
  console.log(`  With source (all categories): ${withSource.length} → try targeted reprocess before deleting`);
  console.log("\nSuggested order: (1) reprocess rows with resolvable Gmail id, (2) manually review million/zero amounts, (3) delete orphan junk only after confirming no Drive copy.");
}

async function printReprocessBreakdown(rows: AuditRow[]) {
  const uniqueKeys = new Set<string>();
  const flagged: AuditRow[] = [];
  for (const row of rows) {
    const key = `${row.table}:${row.id}`;
    if (uniqueKeys.has(key)) continue;
    uniqueKeys.add(key);
    flagged.push(row);
  }

  const emailGmailIdByOrg = new Map<string, Map<string, string | null>>();
  const orgIds = [...new Set(flagged.map((row) => row.organizationId))];
  for (const organizationId of orgIds) {
    const orgEmailIds = flagged
      .filter((row) => row.organizationId === organizationId)
      .map((row) => row.emailMessageId)
      .filter((id): id is string => Boolean(id));
    emailGmailIdByOrg.set(organizationId, await loadEmailGmailIdMap(auditPrisma, organizationId, orgEmailIds));
  }

  const counts: Record<ReprocessSourceCapability, number> = {
    direct_gmail: 0,
    resolvable_via_email: 0,
    no_gmail_link: 0,
  };
  const byTable = new Map<TableName, Record<ReprocessSourceCapability, number>>();
  for (const table of ["GmailScanItem", "Invoice", "FinancialDocumentReview"] as const) {
    byTable.set(table, { direct_gmail: 0, resolvable_via_email: 0, no_gmail_link: 0 });
  }

  for (const row of flagged) {
    const capability = classifyReprocessSourceCapability(
      { gmailMessageId: row.gmailMessageId, emailMessageId: row.emailMessageId },
      emailGmailIdByOrg.get(row.organizationId) ?? new Map()
    );
    counts[capability]++;
    byTable.get(row.table)![capability]++;
  }

  console.log("\n=== Reprocess capability breakdown (distinct flagged records) ===");
  console.log(`Total distinct flagged: ${flagged.length}`);
  console.log(`  direct gmailMessageId on record: ${counts.direct_gmail} → reprocess ready now`);
  console.log(`  emailMessageId resolves to EmailMessage.gmailId: ${counts.resolvable_via_email} → reprocess after lookup (e.g. review_ quarantine rows)`);
  console.log(`  no Gmail link (cannot reprocess from Gmail): ${counts.no_gmail_link}`);

  for (const table of ["GmailScanItem", "Invoice", "FinancialDocumentReview"] as const) {
    const tableCounts = byTable.get(table)!;
    const tableTotal = tableCounts.direct_gmail + tableCounts.resolvable_via_email + tableCounts.no_gmail_link;
    console.log(`\n  [${table}] total=${tableTotal}`);
    console.log(`    direct gmailMessageId: ${tableCounts.direct_gmail}`);
    console.log(`    resolvable via emailMessageId: ${tableCounts.resolvable_via_email}`);
    console.log(`    no Gmail link: ${tableCounts.no_gmail_link}`);
  }

  const resolvableSamples = flagged
    .filter((row) =>
      classifyReprocessSourceCapability(
        { gmailMessageId: row.gmailMessageId, emailMessageId: row.emailMessageId },
        emailGmailIdByOrg.get(row.organizationId) ?? new Map()
      ) === "resolvable_via_email"
    )
    .slice(0, 5);
  if (resolvableSamples.length) {
    console.log("\n  Sample resolvable-via-email (up to 5):");
    for (const row of resolvableSamples) {
      console.log(
        `    ${row.table} id=${row.id} supplier="${row.supplierName ?? "—"}" gmailMessageId=${row.gmailMessageId ?? "null"} emailMessageId=${row.emailMessageId ?? "null"}`
      );
    }
  }
}

async function main() {
  console.log("=== Invoice junk audit (READ-ONLY DRY-RUN) ===");
  console.log(`Criteria: isLikelyJunkSupplierName | amount=${MILLION} | amount 0/null\n`);

  const [gmailRows, invoiceRows, reviewRows] = await Promise.all([
    safeLoad("GmailScanItem", loadGmailScanItems, []),
    safeLoad("Invoice", loadInvoices, []),
    safeLoad("FinancialDocumentReview", loadFinancialDocumentReviews, []),
  ]);
  const allRows = [...gmailRows, ...invoiceRows, ...reviewRows];
  const counts = countByTableAndCategory(allRows);

  printSummary(counts);

  console.log("\n=== Samples (up to 10 per table per category) ===");
  for (const table of ["GmailScanItem", "Invoice", "FinancialDocumentReview"] as const) {
    for (const category of ["junk_supplier", "million", "zero_amount"] as const) {
      printSample(allRows, category, table);
    }
  }

  printRecommendation(allRows);
  await printReprocessBreakdown(allRows);
  console.log("\nNATALIE-JUNK-AUDIT-READY");
}

main()
  .catch((err) => {
    console.error("[audit-invoice-junk] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await auditPrisma.$disconnect();
  });
