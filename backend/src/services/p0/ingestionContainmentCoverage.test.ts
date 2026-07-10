import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const CONTAINMENT_GUARD_PATTERN =
  /\b(assertFinancialIngestionAllowed\s*\(|isFinancialDataContainmentActive\s*\()/;

/**
 * Canonical financial ingestion entry points. CI fails if a new writer is added
 * without calling assertFinancialIngestionAllowed or isFinancialDataContainmentActive.
 */
export const FINANCIAL_INGESTION_ENTRY_POINTS = [
  { file: "src/services/gmail-sync.ts", fn: "syncGmailForOrganization" },
  { file: "src/services/invoiceScanner.ts", fn: "scanForInvoices" },
  { file: "src/services/clientGmailSync.ts", fn: "syncGmailForClient" },
  { file: "src/services/whatsappInvoiceIngestion.ts", fn: "ingestWhatsAppInvoiceMedia" },
  { file: "src/services/financialDocuments.ts", fn: "recordFinancialDocumentDecision" },
  { file: "src/services/scheduler.ts", fn: "runFirstTimeScan" },
  { file: "src/services/scheduler.ts", fn: "runDailyScan" },
  { file: "src/services/scheduler.ts", fn: "runQuickScan" },
  { file: "src/services/scheduler.ts", fn: "runAutomaticGmailScans" },
  { file: "src/services/scheduler.ts", fn: "runFastGmailScans" },
] as const;

function extractFunctionBody(source: string, functionName: string): string {
  const patterns = [
    new RegExp(`export\\s+async\\s+function\\s+${functionName}\\s*\\(`),
    new RegExp(`async\\s+${functionName}\\s*\\(`),
  ];
  let start = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) {
      start = match.index;
      break;
    }
  }
  if (start < 0) {
    throw new Error(`Function not found: ${functionName}`);
  }

  const paramClose = source.indexOf(")", start);
  if (paramClose < 0) {
    throw new Error(`Parameter list not found for: ${functionName}`);
  }
  const braceStart = source.indexOf("{", paramClose);
  if (braceStart < 0) {
    throw new Error(`Opening brace not found for: ${functionName}`);
  }

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }

  throw new Error(`Unbalanced braces for: ${functionName}`);
}

function entryPointHasContainmentGuard(file: string, fn: string): boolean {
  const source = readFileSync(join(backendRoot, file), "utf8");
  const body = extractFunctionBody(source, fn);
  return CONTAINMENT_GUARD_PATTERN.test(body);
}

test("every financial ingestion entry point enforces containment", () => {
  const missing: string[] = [];
  for (const entry of FINANCIAL_INGESTION_ENTRY_POINTS) {
    if (!entryPointHasContainmentGuard(entry.file, entry.fn)) {
      missing.push(`${entry.file}::${entry.fn}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Missing assertFinancialIngestionAllowed or isFinancialDataContainmentActive in: ${missing.join(", ")}`,
  );
});

test("registry documents all known ingestion entry points", () => {
  assert.equal(FINANCIAL_INGESTION_ENTRY_POINTS.length, 10);
});
