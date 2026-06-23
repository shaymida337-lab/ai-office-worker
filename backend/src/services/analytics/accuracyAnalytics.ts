import type { PrismaClient } from "@prisma/client";
import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";
import { computeAnalyticsSummary } from "./analyticsAggregator.js";
import type {
  AnalyticsDocumentRecord,
  AmountMetrics,
  GoldenMetrics,
  OutcomeMetrics,
  PerformanceMetrics,
  SupplierMetrics,
  TrustMetrics,
} from "./analyticsTypes.js";

export type AccuracyAnalyticsSource = "gmail" | "all";

export type AccuracyAnalyticsQuery = {
  days: 7 | 30 | 90;
  source: AccuracyAnalyticsSource;
};

export type AccuracyAnalyticsDateRange = {
  days: 7 | 30 | 90;
  from: string;
  to: string;
};

export type AccuracyAnalyticsResponse = {
  version: string;
  dateRange: AccuracyAnalyticsDateRange;
  source: AccuracyAnalyticsSource;
  documentCount: number;
  outcome: OutcomeMetrics;
  supplier: SupplierMetrics;
  amount: AmountMetrics;
  trust: TrustMetrics;
  performance: PerformanceMetrics;
  golden: GoldenMetrics;
};

export const ACCURACY_ANALYTICS_ROUTE_PATH = "/internal/analytics/accuracy" as const;

export const FORBIDDEN_ACCURACY_RESPONSE_KEYS = [
  "parsedFieldsJson",
  "rawAnalysis",
  "rawOcrText",
  "supplierName",
  "senderEmail",
  "sender",
  "subject",
  "invoiceNumber",
  "emailSender",
  "gmailMessageLink",
  "driveFileLink",
  "driveFileUrl",
] as const;

type AnalyticsParsedFields = {
  amount?: number | null;
  arc?: {
    selectedAmount?: number | null;
    confidence?: number | null;
    evidenceScore?: number | null;
    status?: string | null;
  } | null;
  sir?: {
    supplierName?: string | null;
    canonicalSupplier?: string | null;
    status?: string | null;
    confidence?: number | null;
    evidenceScore?: number | null;
  } | null;
  fse?: {
    trustScore?: number | null;
    overallStatus?: string | null;
  } | null;
  trust?: {
    confidence?: number | null;
    decision?: string | null;
  } | null;
  outcome?: {
    status?: string | null;
  } | null;
  performance?: {
    processingMs?: number | null;
    aiMs?: number | null;
    ocrMs?: number | null;
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAccuracyAnalyticsQuery(query: Record<string, unknown>): AccuracyAnalyticsQuery {
  const daysRaw = typeof query.days === "string" ? query.days.trim() : "30";
  const days: 7 | 30 | 90 = daysRaw === "7" ? 7 : daysRaw === "90" ? 90 : 30;

  const sourceRaw = typeof query.source === "string" ? query.source.trim().toLowerCase() : "all";
  const source: AccuracyAnalyticsSource = sourceRaw === "gmail" ? "gmail" : "all";

  return { days, source };
}

export function buildAccuracyAnalyticsDateRange(
  days: 7 | 30 | 90,
  now: Date = new Date()
): AccuracyAnalyticsDateRange {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);
  from.setUTCHours(0, 0, 0, 0);

  return {
    days,
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function parseParsedFields(value: unknown): AnalyticsParsedFields | null {
  if (!isRecord(value)) return null;
  return value as AnalyticsParsedFields;
}

function normalizeOutcomeStatus(
  parsed: AnalyticsParsedFields | null,
  reviewStatus?: string | null
): DocumentOutcomeStatus {
  const stored = parsed?.outcome?.status;
  if (
    stored === "SAVED" ||
    stored === "NEEDS_REVIEW" ||
    stored === "DUPLICATE" ||
    stored === "NOT_FINANCIAL" ||
    stored === "ERROR" ||
    stored === "BLOCKED"
  ) {
    return stored;
  }

  const normalizedReview = reviewStatus?.trim().toLowerCase() ?? "";
  if (normalizedReview === "auto_saved" || normalizedReview === "approved") return "SAVED";
  if (normalizedReview === "rejected" || normalizedReview === "blocked") return "BLOCKED";
  if (normalizedReview === "duplicate") return "DUPLICATE";
  if (normalizedReview === "needs_review") return "NEEDS_REVIEW";
  return "NEEDS_REVIEW";
}

export function mapAccuracyAnalyticsRow(input: {
  id: string;
  amount?: number | null;
  supplierName?: string | null;
  reviewStatus?: string | null;
  parsedFieldsJson?: unknown;
  duplicateDetected?: boolean | null;
}): AnalyticsDocumentRecord {
  const parsed = parseParsedFields(input.parsedFieldsJson);
  const amount =
    parsed?.arc?.selectedAmount ??
    parsed?.amount ??
    input.amount ??
    null;

  return {
    id: input.id,
    outcomeStatus: normalizeOutcomeStatus(parsed, input.reviewStatus),
    supplierName: parsed?.sir?.canonicalSupplier ?? parsed?.sir?.supplierName ?? input.supplierName ?? null,
    supplierStatus: parsed?.sir?.status ?? null,
    amount,
    suspiciousAmount:
      parsed?.fse?.overallStatus === "error" ||
      Boolean(input.duplicateDetected),
    trustConfidence: parsed?.trust?.confidence ?? null,
    arcConfidence: parsed?.arc?.confidence ?? parsed?.arc?.evidenceScore ?? null,
    sirConfidence: parsed?.sir?.confidence ?? parsed?.sir?.evidenceScore ?? null,
    fseTrustScore: parsed?.fse?.trustScore ?? null,
    processingMs: parsed?.performance?.processingMs ?? null,
    aiMs: parsed?.performance?.aiMs ?? null,
    ocrMs: parsed?.performance?.ocrMs ?? null,
  };
}

export function buildAccuracyAnalyticsResponse(input: {
  query: AccuracyAnalyticsQuery;
  documents: AnalyticsDocumentRecord[];
  now?: Date;
}): AccuracyAnalyticsResponse {
  const summary = computeAnalyticsSummary(input.documents, null);
  const dateRange = buildAccuracyAnalyticsDateRange(input.query.days, input.now);

  return {
    version: summary.version,
    dateRange,
    source: input.query.source,
    documentCount: summary.documentCount,
    outcome: summary.outcome,
    supplier: summary.supplier,
    amount: summary.amount,
    trust: summary.trust,
    performance: summary.performance,
    golden: summary.golden,
  };
}

export function accuracyAnalyticsResponseContainsForbiddenFields(value: unknown): string | null {
  if (value == null) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = accuracyAnalyticsResponseContainsForbiddenFields(item);
      if (nested) return nested;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const key of Object.keys(value)) {
    if ((FORBIDDEN_ACCURACY_RESPONSE_KEYS as readonly string[]).includes(key)) {
      return key;
    }
    const nested = accuracyAnalyticsResponseContainsForbiddenFields(value[key]);
    if (nested) return nested;
  }

  return null;
}

export type AccuracyAnalyticsDb = Pick<
  PrismaClient,
  "gmailScanItem" | "financialDocumentReview" | "supplierPayment"
>;

export async function loadAccuracyAnalyticsDocuments(
  db: AccuracyAnalyticsDb,
  organizationId: string,
  query: AccuracyAnalyticsQuery,
  now: Date = new Date()
): Promise<AnalyticsDocumentRecord[]> {
  if (!organizationId.trim()) {
    throw new Error("organizationId is required");
  }

  const dateRange = buildAccuracyAnalyticsDateRange(query.days, now);
  const createdAtFilter = {
    gte: new Date(dateRange.from),
    lte: new Date(dateRange.to),
  };

  const gmailRows = await db.gmailScanItem.findMany({
    where: {
      organizationId,
      createdAt: createdAtFilter,
    },
    select: {
      id: true,
      amount: true,
      supplierName: true,
      reviewStatus: true,
      parsedFieldsJson: true,
      gmailMessageId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const documents = gmailRows.map((row) =>
    mapAccuracyAnalyticsRow({
      id: `gsi:${row.id}`,
      amount: row.amount,
      supplierName: row.supplierName,
      reviewStatus: row.reviewStatus,
      parsedFieldsJson: row.parsedFieldsJson,
    })
  );

  if (query.source === "gmail") {
    return documents;
  }

  const gmailMessageIds = new Set(gmailRows.map((row) => row.gmailMessageId).filter(Boolean));

  const [reviewRows, paymentRows] = await Promise.all([
    db.financialDocumentReview.findMany({
      where: {
        organizationId,
        createdAt: createdAtFilter,
      },
      select: {
        id: true,
        totalAmount: true,
        supplierName: true,
        reviewStatus: true,
        parsedFieldsJson: true,
        gmailMessageId: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.supplierPayment.findMany({
      where: {
        organizationId,
        createdAt: createdAtFilter,
      },
      select: {
        id: true,
        amount: true,
        totalAmount: true,
        supplier: true,
        supplierName: true,
        approvalStatus: true,
        parsedFieldsJson: true,
        duplicateDetected: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  for (const row of reviewRows) {
    if (row.gmailMessageId && gmailMessageIds.has(row.gmailMessageId)) continue;
    documents.push(
      mapAccuracyAnalyticsRow({
        id: `fdr:${row.id}`,
        amount: row.totalAmount,
        supplierName: row.supplierName,
        reviewStatus: row.reviewStatus,
        parsedFieldsJson: row.parsedFieldsJson,
      })
    );
  }

  for (const row of paymentRows) {
    documents.push(
      mapAccuracyAnalyticsRow({
        id: `sp:${row.id}`,
        amount: row.totalAmount ?? row.amount,
        supplierName: row.supplierName ?? row.supplier,
        reviewStatus: row.approvalStatus,
        parsedFieldsJson: row.parsedFieldsJson,
        duplicateDetected: row.duplicateDetected,
      })
    );
  }

  return documents;
}

export async function getAccuracyAnalyticsForOrganization(
  db: AccuracyAnalyticsDb,
  organizationId: string,
  query: AccuracyAnalyticsQuery,
  now: Date = new Date()
): Promise<AccuracyAnalyticsResponse> {
  const documents = await loadAccuracyAnalyticsDocuments(db, organizationId, query, now);
  const response = buildAccuracyAnalyticsResponse({ query, documents, now });
  const forbidden = accuracyAnalyticsResponseContainsForbiddenFields(response);
  if (forbidden) {
    throw new Error(`accuracy analytics response contains forbidden field: ${forbidden}`);
  }
  return response;
}
