/**
 * Read-only Golden Dataset staging extractor for Render Shell.
 *
 * Run:
 *   cd backend && npx tsx scripts/golden-extract-candidate.ts \
 *     --orgId <organizationId> \
 *     --source GmailScanItem|FinancialDocumentReview|SupplierPayment \
 *     --id <recordId> \
 *     [--outDir <path>]
 *
 * Writes sanitized JSON only to the gitignored .staging folder (or --outDir).
 * Never mutates production data. Never exports PDFs/images.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { containsLikelyPii } from "../src/services/golden/goldenSanitizer.js";
import {
  buildGoldenStagingDocument,
  DEFAULT_GOLDEN_STAGING_DIR,
  parseGoldenParsedFieldsJson,
  writeGoldenStagingCase,
  type GoldenSourceRecord,
  type GoldenSourceTable,
  type GoldenStagingDocument,
} from "../src/services/golden/goldenExtractor.js";

const VALID_SOURCES: readonly GoldenSourceTable[] = [
  "GmailScanItem",
  "FinancialDocumentReview",
  "SupplierPayment",
];

export type GoldenExtractCliArgs = {
  orgId: string;
  source: GoldenSourceTable | "";
  id: string;
  outDir: string;
};

export type GoldenExtractCliValidationError = {
  code: "missing_org" | "missing_id" | "missing_source" | "invalid_source";
  message: string;
};

export type GoldenStagingPiiSafetyResult = {
  passed: boolean;
  reason: string | null;
};

export function parseGoldenExtractCliArgs(argv: string[]): GoldenExtractCliArgs {
  let orgId = "";
  let source: GoldenSourceTable | "" = "";
  let id = "";
  let outDir = DEFAULT_GOLDEN_STAGING_DIR;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--orgId") {
      orgId = argv[++index]?.trim() ?? "";
      continue;
    }
    if (arg === "--source") {
      source = (argv[++index]?.trim() ?? "") as GoldenSourceTable | "";
      continue;
    }
    if (arg === "--id") {
      id = argv[++index]?.trim() ?? "";
      continue;
    }
    if (arg === "--outDir") {
      outDir = argv[++index]?.trim() ?? outDir;
      continue;
    }
  }

  return { orgId, source, id, outDir };
}

export function validateGoldenExtractCliArgs(
  args: GoldenExtractCliArgs
): GoldenExtractCliValidationError | null {
  if (!args.orgId) {
    return { code: "missing_org", message: "orgId is required (--orgId)" };
  }
  if (!args.id) {
    return { code: "missing_id", message: "id is required (--id)" };
  }
  if (!args.source) {
    return { code: "missing_source", message: "source is required (--source)" };
  }
  if (!VALID_SOURCES.includes(args.source)) {
    return {
      code: "invalid_source",
      message: `invalid source "${args.source}"; expected one of: ${VALID_SOURCES.join(", ")}`,
    };
  }
  return null;
}

export function assessGoldenStagingPiiSafety(
  document: GoldenStagingDocument,
  orgId: string
): GoldenStagingPiiSafetyResult {
  const caseJson = JSON.stringify(document.case);
  if (caseJson.includes(orgId)) {
    return { passed: false, reason: "output contains source organization id" };
  }
  if (containsLikelyPii(caseJson)) {
    return { passed: false, reason: "output contains likely PII after sanitization" };
  }
  return { passed: true, reason: null };
}

function toGoldenSourceRecord(
  source: GoldenSourceTable,
  row: {
    id: string;
    documentType: string;
    supplierName: string | null;
    amount: number | null;
    parsedFieldsJson: unknown;
    decisionReason: string | null;
    reviewStatus: string | null;
    createdAt: Date;
    sourceChannel?: string | null;
    currency?: string | null;
  }
): GoldenSourceRecord {
  return {
    id: row.id,
    sourceTable: source,
    documentType: row.documentType,
    supplierName: row.supplierName,
    amount: row.amount,
    currency: row.currency ?? undefined,
    parsedFieldsJson: parseGoldenParsedFieldsJson(row.parsedFieldsJson),
    decisionReason: row.decisionReason,
    reviewStatus: row.reviewStatus,
    source: row.sourceChannel ?? undefined,
    createdAt: row.createdAt,
  };
}

async function loadGoldenSourceRecord(
  orgId: string,
  source: GoldenSourceTable,
  id: string
): Promise<GoldenSourceRecord | null> {
  if (source === "GmailScanItem") {
    const row = await prisma.gmailScanItem.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        documentType: true,
        supplierName: true,
        amount: true,
        parsedFieldsJson: true,
        decisionReason: true,
        reviewStatus: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    return toGoldenSourceRecord(source, {
      ...row,
      supplierName: row.supplierName ?? null,
      amount: row.amount ?? null,
      decisionReason: row.decisionReason ?? null,
      reviewStatus: row.reviewStatus ?? null,
      sourceChannel: "gmail",
    });
  }

  if (source === "FinancialDocumentReview") {
    const row = await prisma.financialDocumentReview.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        documentType: true,
        supplierName: true,
        totalAmount: true,
        currency: true,
        parsedFieldsJson: true,
        uncertaintyReason: true,
        reviewStatus: true,
        source: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    return toGoldenSourceRecord(source, {
      id: row.id,
      documentType: row.documentType,
      supplierName: row.supplierName ?? null,
      amount: row.totalAmount ?? null,
      parsedFieldsJson: row.parsedFieldsJson,
      decisionReason: row.uncertaintyReason ?? null,
      reviewStatus: row.reviewStatus ?? null,
      createdAt: row.createdAt,
      sourceChannel: row.source,
      currency: row.currency,
    });
  }

  const row = await prisma.supplierPayment.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      documentTypeDetailed: true,
      supplierName: true,
      supplier: true,
      amount: true,
      totalAmount: true,
      currency: true,
      parsedFieldsJson: true,
      duplicateReason: true,
      approvalStatus: true,
      source: true,
      createdAt: true,
    },
  });
  if (!row) return null;

  return toGoldenSourceRecord(source, {
    id: row.id,
    documentType: row.documentTypeDetailed ?? "supplier_payment",
    supplierName: row.supplierName ?? row.supplier ?? null,
    amount: row.totalAmount ?? row.amount ?? null,
    parsedFieldsJson: row.parsedFieldsJson,
    decisionReason: row.duplicateReason ?? null,
    reviewStatus: row.approvalStatus ?? null,
    createdAt: row.createdAt,
    sourceChannel: row.source,
    currency: row.currency,
  });
}

export type GoldenExtractResult = {
  stagingFilePath: string;
  caseId: string;
  sourceTable: GoldenSourceTable;
  piiSafetyCheck: "pass" | "fail";
  piiSafetyReason: string | null;
};

export async function runGoldenExtractCandidate(
  args: GoldenExtractCliArgs
): Promise<GoldenExtractResult> {
  const validationError = validateGoldenExtractCliArgs(args);
  if (validationError) {
    throw new Error(validationError.message);
  }

  const source = args.source as GoldenSourceTable;
  const record = await loadGoldenSourceRecord(args.orgId, source, args.id);
  if (!record) {
    throw new Error(
      `record not found for source=${source} id=${args.id} orgId=${args.orgId}`
    );
  }

  const document = buildGoldenStagingDocument(record);
  const piiSafety = assessGoldenStagingPiiSafety(document, args.orgId);
  if (!piiSafety.passed) {
    throw new Error(`PII safety check failed: ${piiSafety.reason}`);
  }

  const stagingFilePath = writeGoldenStagingCase(document, args.outDir);

  return {
    stagingFilePath,
    caseId: document.case.id,
    sourceTable: source,
    piiSafetyCheck: "pass",
    piiSafetyReason: null,
  };
}

async function main() {
  const args = parseGoldenExtractCliArgs(process.argv.slice(2));
  const validationError = validateGoldenExtractCliArgs(args);
  if (validationError) {
    console.error(`[golden-extract-candidate] ${validationError.message}`);
    console.error(
      "Usage: npx tsx scripts/golden-extract-candidate.ts --orgId <org> --source GmailScanItem|FinancialDocumentReview|SupplierPayment --id <recordId> [--outDir <path>]"
    );
    process.exit(1);
  }

  try {
    const result = await runGoldenExtractCandidate(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[golden-extract-candidate] failed: ${message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("golden-extract-candidate.ts") ||
    process.argv[1].endsWith("golden-extract-candidate.js"));

if (isDirectExecution) {
  main().catch((error) => {
    console.error("[golden-extract-candidate] failed", error);
    process.exit(1);
  });
}
