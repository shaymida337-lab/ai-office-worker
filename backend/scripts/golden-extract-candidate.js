"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGoldenExtractCliArgs = parseGoldenExtractCliArgs;
exports.validateGoldenExtractCliArgs = validateGoldenExtractCliArgs;
exports.assessGoldenStagingPiiSafety = assessGoldenStagingPiiSafety;
exports.runGoldenExtractCandidate = runGoldenExtractCandidate;
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
require("dotenv/config");
const prisma_js_1 = require("../src/lib/prisma.js");
const goldenSanitizer_js_1 = require("../src/services/golden/goldenSanitizer.js");
const goldenExtractor_js_1 = require("../src/services/golden/goldenExtractor.js");
const VALID_SOURCES = [
    "GmailScanItem",
    "FinancialDocumentReview",
    "SupplierPayment",
];
function parseGoldenExtractCliArgs(argv) {
    let orgId = "";
    let source = "";
    let id = "";
    let outDir = goldenExtractor_js_1.DEFAULT_GOLDEN_STAGING_DIR;
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === "--orgId") {
            orgId = argv[++index]?.trim() ?? "";
            continue;
        }
        if (arg === "--source") {
            source = (argv[++index]?.trim() ?? "");
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
function validateGoldenExtractCliArgs(args) {
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
function assessGoldenStagingPiiSafety(document, orgId) {
    const caseJson = JSON.stringify(document.case);
    if (caseJson.includes(orgId)) {
        return { passed: false, reason: "output contains source organization id" };
    }
    if ((0, goldenSanitizer_js_1.containsLikelyPii)(caseJson)) {
        return { passed: false, reason: "output contains likely PII after sanitization" };
    }
    return { passed: true, reason: null };
}
function toGoldenSourceRecord(source, row) {
    return {
        id: row.id,
        sourceTable: source,
        documentType: row.documentType,
        supplierName: row.supplierName,
        amount: row.amount,
        currency: row.currency ?? undefined,
        parsedFieldsJson: (0, goldenExtractor_js_1.parseGoldenParsedFieldsJson)(row.parsedFieldsJson),
        decisionReason: row.decisionReason,
        reviewStatus: row.reviewStatus,
        source: row.sourceChannel ?? undefined,
        createdAt: row.createdAt,
    };
}
async function loadGoldenSourceRecord(orgId, source, id) {
    if (source === "GmailScanItem") {
        const row = await prisma_js_1.prisma.gmailScanItem.findFirst({
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
        if (!row)
            return null;
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
        const row = await prisma_js_1.prisma.financialDocumentReview.findFirst({
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
        if (!row)
            return null;
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
    const row = await prisma_js_1.prisma.supplierPayment.findFirst({
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
    if (!row)
        return null;
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
async function runGoldenExtractCandidate(args) {
    const validationError = validateGoldenExtractCliArgs(args);
    if (validationError) {
        throw new Error(validationError.message);
    }
    const source = args.source;
    const record = await loadGoldenSourceRecord(args.orgId, source, args.id);
    if (!record) {
        throw new Error(`record not found for source=${source} id=${args.id} orgId=${args.orgId}`);
    }
    const document = (0, goldenExtractor_js_1.buildGoldenStagingDocument)(record);
    const piiSafety = assessGoldenStagingPiiSafety(document, args.orgId);
    if (!piiSafety.passed) {
        throw new Error(`PII safety check failed: ${piiSafety.reason}`);
    }
    const stagingFilePath = (0, goldenExtractor_js_1.writeGoldenStagingCase)(document, args.outDir);
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
        console.error("Usage: npx tsx scripts/golden-extract-candidate.ts --orgId <org> --source GmailScanItem|FinancialDocumentReview|SupplierPayment --id <recordId> [--outDir <path>]");
        process.exit(1);
    }
    try {
        const result = await runGoldenExtractCandidate(args);
        console.log(JSON.stringify(result, null, 2));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[golden-extract-candidate] failed: ${message}`);
        process.exit(1);
    }
    finally {
        await prisma_js_1.prisma.$disconnect();
    }
}
const isDirectExecution = typeof process.argv[1] === "string" &&
    (process.argv[1].endsWith("golden-extract-candidate.ts") ||
        process.argv[1].endsWith("golden-extract-candidate.js"));
if (isDirectExecution) {
    main().catch((error) => {
        console.error("[golden-extract-candidate] failed", error);
        process.exit(1);
    });
}
