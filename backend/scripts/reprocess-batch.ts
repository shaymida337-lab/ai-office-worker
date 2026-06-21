/**
 * Batch reprocess for flagged invoice records (same junk criteria as audit-invoice-junk.ts).
 *
 * Modes:
 *   npx tsx scripts/reprocess-batch.ts
 *     → DRY-RUN all reprocessable flagged records (no DB writes)
 *   npx tsx scripts/reprocess-batch.ts --apply --limit=25
 *     → apply up to 25 records (default limit 25)
 *   npx tsx scripts/reprocess-batch.ts --apply --all
 *     → apply all in internal chunks of 25 with pause between chunks
 */
import "dotenv/config";
import { writeSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { isLikelyJunkSupplierName } from "../src/services/supplierNameValidation.js";
import {
  classifyReprocessSourceCapability,
  loadEmailGmailIdMap,
  reprocessFinancialDocumentBySource,
  type ReprocessFinancialDocumentParams,
  type ReprocessSourceTable,
} from "../src/services/reprocessFinancialDocument.js";

const MILLION = 1_000_000;
const CHUNK_SIZE = 25;
const CHUNK_PAUSE_MS = 2_000;
const CHUNK_FAIL_RATIO = 0.2;

/** Immediate flush — log buffers when stdout is piped (nohup → file). */
function log(message = "") {
  writeSync(1, `${message}\n`);
}

function logErr(message: string) {
  writeSync(2, `${message}\n`);
}

type FlaggedRecord = {
  table: ReprocessSourceTable;
  id: string;
  organizationId: string;
  supplierName: string | null;
  amount: number | null;
  gmailMessageId: string | null;
  emailMessageId: string | null;
};

type BatchStats = {
  candidatesTotal: number;
  skippedNoGmailLink: number;
  processed: number;
  wouldChange: number;
  noChange: number;
  skippedUntrusted: number;
  skippedUntrustedReasons: Record<string, number>;
  failed: number;
  applied: number;
  applySucceeded: number;
};

function isMillionAmount(amount: number | null | undefined) {
  return amount != null && Number.isFinite(amount) && amount === MILLION;
}

function isZeroOrMissingAmount(amount: number | null | undefined) {
  return amount == null || amount === 0;
}

function isFlagged(input: { supplierName: string | null | undefined; amount: number | null | undefined }) {
  const supplier = input.supplierName?.trim() ?? "";
  return (
    (supplier.length > 0 && isLikelyJunkSupplierName(supplier)) ||
    isMillionAmount(input.amount ?? null) ||
    isZeroOrMissingAmount(input.amount ?? null)
  );
}

function reprocessParamsForRecord(record: FlaggedRecord): ReprocessFinancialDocumentParams {
  const base = { organizationId: record.organizationId };
  switch (record.table) {
    case "GmailScanItem":
      return { ...base, gmailScanItemId: record.id };
    case "Invoice":
      return { ...base, invoiceId: record.id };
    case "FinancialDocumentReview":
      return { ...base, financialDocumentReviewId: record.id };
  }
}

function formatSnapshot(snapshot: { supplier: string | null; amount: number | null; date: Date | null }) {
  const date = snapshot.date ? snapshot.date.toISOString().slice(0, 10) : "null";
  return `supplier="${snapshot.supplier ?? "null"}" amount=${snapshot.amount ?? "null"} date=${date}`;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const all = argv.includes("--all");
  let limit = 25;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" && argv[i + 1]) {
      limit = Number.parseInt(argv[i + 1]!, 10);
    } else if (arg?.startsWith("--limit=")) {
      limit = Number.parseInt(arg.slice("--limit=".length), 10);
    }
  }

  if (!Number.isFinite(limit) || limit <= 0) limit = 25;
  return { apply, all, limit };
}

async function loadFlaggedRecords(): Promise<FlaggedRecord[]> {
  const flagged: FlaggedRecord[] = [];

  const scanItems = await prisma.gmailScanItem.findMany({
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      amount: true,
      gmailMessageId: true,
      emailMessageId: true,
    },
  });
  for (const row of scanItems) {
    if (!isFlagged({ supplierName: row.supplierName, amount: row.amount })) continue;
    flagged.push({
      table: "GmailScanItem",
      id: row.id,
      organizationId: row.organizationId,
      supplierName: row.supplierName,
      amount: row.amount,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailMessageId,
    });
  }

  const invoices = await prisma.invoice.findMany({
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      amount: true,
      gmailMessageId: true,
      emailId: true,
    },
  });
  for (const row of invoices) {
    if (!isFlagged({ supplierName: row.supplierName, amount: row.amount })) continue;
    flagged.push({
      table: "Invoice",
      id: row.id,
      organizationId: row.organizationId,
      supplierName: row.supplierName,
      amount: row.amount,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailId,
    });
  }

  const reviews = await prisma.financialDocumentReview.findMany({
    select: {
      id: true,
      organizationId: true,
      supplierName: true,
      totalAmount: true,
      gmailMessageId: true,
      emailMessageId: true,
    },
  });
  for (const row of reviews) {
    if (!isFlagged({ supplierName: row.supplierName, amount: row.totalAmount })) continue;
    flagged.push({
      table: "FinancialDocumentReview",
      id: row.id,
      organizationId: row.organizationId,
      supplierName: row.supplierName,
      amount: row.totalAmount,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailMessageId,
    });
  }

  const unique = new Map<string, FlaggedRecord>();
  for (const row of flagged) unique.set(`${row.table}:${row.id}`, row);
  return [...unique.values()];
}

async function filterReprocessableCandidates(allFlagged: FlaggedRecord[]) {
  const emailGmailIdByOrg = new Map<string, Map<string, string | null>>();
  const orgIds = [...new Set(allFlagged.map((row) => row.organizationId))];
  for (const organizationId of orgIds) {
    const emailIds = allFlagged
      .filter((row) => row.organizationId === organizationId)
      .map((row) => row.emailMessageId)
      .filter((id): id is string => Boolean(id));
    emailGmailIdByOrg.set(organizationId, await loadEmailGmailIdMap(prisma, organizationId, emailIds));
  }

  const reprocessable: FlaggedRecord[] = [];
  let skippedNoGmailLink = 0;
  for (const row of allFlagged) {
    const capability = classifyReprocessSourceCapability(
      { gmailMessageId: row.gmailMessageId, emailMessageId: row.emailMessageId },
      emailGmailIdByOrg.get(row.organizationId) ?? new Map()
    );
    if (capability === "no_gmail_link") {
      skippedNoGmailLink++;
      continue;
    }
    reprocessable.push(row);
  }

  return { reprocessable, skippedNoGmailLink };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processOneRecord(record: FlaggedRecord, apply: boolean, stats: BatchStats) {
  const params = reprocessParamsForRecord(record);
  const preview = await reprocessFinancialDocumentBySource({ ...params, dryRun: true });
  stats.processed++;

  if (!preview.wouldChange) {
    stats.noChange++;
    return;
  }

  if (!preview.trustworthy) {
    stats.skippedUntrusted++;
    const reason = preview.skipReason ?? "unknown";
    stats.skippedUntrustedReasons[reason] = (stats.skippedUntrustedReasons[reason] ?? 0) + 1;
    log(
      `[dry-run] ${record.table} id=${record.id} wouldChange=true trustworthy=false skipReason=${reason} before={${formatSnapshot(preview.before)}} after={${formatSnapshot(preview.after)}}`
    );
    return;
  }

  stats.wouldChange++;

  if (!apply) {
    log(
      `[dry-run] ${record.table} id=${record.id} wouldChange=true trustworthy=true before={${formatSnapshot(preview.before)}} after={${formatSnapshot(preview.after)}}`
    );
    return;
  }

  const applied = await reprocessFinancialDocumentBySource({ ...params, dryRun: false });
  stats.applied++;
  if (applied.updated) stats.applySucceeded++;

  log(
    `[apply] ${record.table} id=${record.id} updated=${applied.updated} skipReason=${applied.skipReason ?? "none"} before={${formatSnapshot(applied.before)}} after={${formatSnapshot(applied.after)}}`
  );
}

async function processChunk(
  records: FlaggedRecord[],
  apply: boolean,
  stats: BatchStats
): Promise<boolean> {
  let chunkProcessed = 0;
  let chunkFailed = 0;

  for (const record of records) {
    try {
      await processOneRecord(record, apply, stats);
      chunkProcessed++;
    } catch (err) {
      stats.failed++;
      chunkFailed++;
      chunkProcessed++;
      const message = err instanceof Error ? err.message : String(err);
      logErr(`[failed] ${record.table} id=${record.id} error="${message.split("\n")[0]}"`);
    }
  }

  if (apply && chunkProcessed > 0 && chunkFailed / chunkProcessed > CHUNK_FAIL_RATIO) {
    logErr(
      `\n[batch-abort] More than ${CHUNK_FAIL_RATIO * 100}% of records in chunk failed (${chunkFailed}/${chunkProcessed}). Stopping — likely a systematic issue.`
    );
    return false;
  }

  return true;
}

function printCandidateBreakdown(allFlagged: FlaggedRecord[], reprocessable: FlaggedRecord[], skippedNoGmailLink: number) {
  const byTable = (rows: FlaggedRecord[]) => ({
    GmailScanItem: rows.filter((r) => r.table === "GmailScanItem").length,
    Invoice: rows.filter((r) => r.table === "Invoice").length,
    FinancialDocumentReview: rows.filter((r) => r.table === "FinancialDocumentReview").length,
  });

  const flaggedByTable = byTable(allFlagged);
  const reproByTable = byTable(reprocessable);

  log("=== Candidate selection (same criteria as audit-invoice-junk.ts) ===");
  log("Flag if ANY of:");
  log("  • isLikelyJunkSupplierName(supplierName)");
  log(`  • amount === ${MILLION}`);
  log("  • amount === 0 or null");
  log("\nSources scanned: GmailScanItem, Invoice, FinancialDocumentReview (deduped by table:id)");
  log(`Total flagged (distinct): ${allFlagged.length}`);
  log(
    `  GmailScanItem=${flaggedByTable.GmailScanItem} Invoice=${flaggedByTable.Invoice} FinancialDocumentReview=${flaggedByTable.FinancialDocumentReview}`
  );
  log(`Skipped (no Gmail link — cannot reprocess): ${skippedNoGmailLink}`);
  log(`Reprocessable candidates: ${reprocessable.length} (~462 in production audit)`);
  log(
    `  GmailScanItem=${reproByTable.GmailScanItem} Invoice=${reproByTable.Invoice} FinancialDocumentReview=${reproByTable.FinancialDocumentReview}`
  );
  log("");
}

function printSummary(stats: BatchStats, mode: string) {
  log("");
  log("=== Batch summary ===");
  log(`Mode: ${mode}`);
  log(`Candidates (reprocessable): ${stats.candidatesTotal}`);
  log(`Skipped upfront (no Gmail link): ${stats.skippedNoGmailLink}`);
  log(`Processed (dry-run or apply attempt): ${stats.processed}`);
  log(`Would change (trusted, needs fix): ${stats.wouldChange}`);
  log(`No change needed (skipped apply): ${stats.noChange}`);
  log(`Skipped untrusted (would change but not applied): ${stats.skippedUntrusted}`);
  if (stats.skippedUntrusted > 0) {
    for (const [reason, count] of Object.entries(stats.skippedUntrustedReasons).sort((a, b) => b[1] - a[1])) {
      log(`  skipReason=${reason}: ${count}`);
    }
  }
  log(`Failed: ${stats.failed}`);
  log(`Applied (dryRun:false calls): ${stats.applied}`);
  log(`Apply succeeded (updated=true): ${stats.applySucceeded}`);
  log("");
  log("=== BATCH COMPLETE ===");
  log(
    `total_processed=${stats.processed} changed=${stats.wouldChange} unchanged=${stats.noChange} skipped_untrusted=${stats.skippedUntrusted} failed=${stats.failed}` +
      (stats.applied > 0 ? ` applied=${stats.applied} apply_succeeded=${stats.applySucceeded}` : "")
  );
}

async function main() {
  const { apply, all, limit } = parseArgs(process.argv.slice(2));
  const mode = !apply
    ? "DRY-RUN (default)"
    : all
      ? `APPLY --all (chunks of ${CHUNK_SIZE})`
      : `APPLY --limit=${limit}`;

  log(`=== Batch reprocess === ${mode}\n`);

  const allFlagged = await loadFlaggedRecords();
  const { reprocessable, skippedNoGmailLink } = await filterReprocessableCandidates(allFlagged);
  printCandidateBreakdown(allFlagged, reprocessable, skippedNoGmailLink);

  const stats: BatchStats = {
    candidatesTotal: reprocessable.length,
    skippedNoGmailLink,
    processed: 0,
    wouldChange: 0,
    noChange: 0,
    skippedUntrusted: 0,
    skippedUntrustedReasons: {},
    failed: 0,
    applied: 0,
    applySucceeded: 0,
  };

  if (!reprocessable.length) {
    printSummary(stats, mode);
    return;
  }

  if (!apply) {
    await processChunk(reprocessable, false, stats);
    printSummary(stats, mode);
    return;
  }

  if (!all) {
    let chunkProcessed = 0;
    let chunkFailed = 0;

    for (const record of reprocessable) {
      if (stats.applied >= limit) break;

      try {
        await processOneRecord(record, true, stats);
        chunkProcessed++;
      } catch (err) {
        stats.failed++;
        chunkFailed++;
        chunkProcessed++;
        const message = err instanceof Error ? err.message : String(err);
        logErr(`[failed] ${record.table} id=${record.id} error="${message.split("\n")[0]}"`);
      }

      if (chunkProcessed >= CHUNK_SIZE) {
        if (chunkProcessed > 0 && chunkFailed / chunkProcessed > CHUNK_FAIL_RATIO) {
          logErr(
            `\n[batch-abort] More than ${CHUNK_FAIL_RATIO * 100}% of records in chunk failed (${chunkFailed}/${chunkProcessed}). Stopping — likely a systematic issue.`
          );
          break;
        }
        chunkProcessed = 0;
        chunkFailed = 0;
      }
    }

    printSummary(stats, mode);
    return;
  }

  const chunks = chunkArray(reprocessable, CHUNK_SIZE);
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      log(`\n[batch] Pause ${CHUNK_PAUSE_MS}ms before chunk ${i + 1}/${chunks.length}...`);
      await sleep(CHUNK_PAUSE_MS);
    }
    log(`\n[batch] Chunk ${i + 1}/${chunks.length} (${chunks[i]!.length} records)`);
    const continueBatch = await processChunk(chunks[i]!, true, stats);
    if (!continueBatch) break;
  }

  printSummary(stats, mode);
}

main()
  .catch((err) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    logErr(`[reprocess-batch] failed: ${message}`);
    logErr("=== BATCH FAILED (did not complete) ===");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
