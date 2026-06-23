import type { PrismaClient } from "@prisma/client";
import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";
import {
  containsLikelyPii,
  maskInvoiceNumbers,
  sanitizeFreeText,
  sanitizeJsonValue,
  sanitizeSupplierLabel,
} from "../golden/goldenSanitizer.js";
import { mapAccuracyAnalyticsRow } from "../analytics/accuracyAnalytics.js";
import { buildAccuracyAnalyticsDateRange } from "../analytics/accuracyAnalytics.js";

export const VERIFICATION_CENTER_ROUTE_PATH = "/internal/verification" as const;
export const VERIFICATION_CENTER_VERSION = "verification-v1" as const;

export type VerificationDays = 7 | 30 | 90;

export type VerificationOutcomeFilter =
  | "SAVED"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "DUPLICATE"
  | "NOT_FINANCIAL"
  | "ERROR";

export type VerificationSupplierFilter = "resolved" | "unknown";
export type VerificationConfidenceFilter = "low" | "medium" | "high";

export type VerificationQuery = {
  days: VerificationDays;
  limit: number;
  cursor: string | null;
  outcome: VerificationOutcomeFilter | null;
  review: string | null;
  supplier: VerificationSupplierFilter | null;
  blocked: boolean;
  duplicate: boolean;
  confidence: VerificationConfidenceFilter | null;
  search: string | null;
};

export type VerificationTimelineStageId =
  | "received"
  | "ai"
  | "scfc"
  | "arc"
  | "sir"
  | "fse"
  | "trust"
  | "outcome";

export type VerificationTimelineStage = {
  id: VerificationTimelineStageId;
  label: string;
  status: "completed" | "warning" | "failed" | "skipped" | "pending" | "unknown";
  confidence: number | null;
  reason: string | null;
  durationMs: number | null;
  summary: string | null;
};

export type VerificationDocumentSummary = {
  documentId: string;
  source: "gmail_scan_item" | "financial_document_review" | "supplier_payment";
  createdAt: string;
  supplier: string | null;
  amount: number | null;
  documentType: string | null;
  reviewStatus: string | null;
  outcomeStatus: DocumentOutcomeStatus;
  trustConfidence: number | null;
  arcConfidence: number | null;
  sirConfidence: number | null;
  fseTrust: number | null;
  goldenMatch: null;
  invoiceNumberMasked: string | null;
  gmailMessageIdPrefix: string | null;
  timeline: VerificationTimelineStage[];
};

export type VerificationCenterResponse = {
  version: string;
  dateRange: { days: VerificationDays; from: string; to: string };
  documents: VerificationDocumentSummary[];
  nextCursor: string | null;
  totalReturned: number;
};

export const FORBIDDEN_VERIFICATION_RESPONSE_KEYS = [
  "parsedFieldsJson",
  "rawAnalysis",
  "rawOcrText",
  "ocrText",
  "analysis",
  "senderEmail",
  "sender",
  "subject",
  "gmailMessageLink",
  "driveFileLink",
  "driveFileUrl",
  "driveUrl",
  "emailBody",
  "bodyText",
  "prompt",
  "evidence",
] as const;

type ParsedFields = {
  amount?: number | null;
  invoiceNumber?: string | null;
  confidence?: number | null;
  reasons?: string[];
  arc?: {
    confidence?: number | null;
    evidenceScore?: number | null;
    reason?: string | null;
    reasonCode?: string | null;
    status?: string | null;
  } | null;
  sir?: {
    supplierName?: string | null;
    canonicalSupplier?: string | null;
    confidence?: number | null;
    evidenceScore?: number | null;
    reason?: string | null;
    reasonCode?: string | null;
    status?: string | null;
  } | null;
  fse?: {
    trustScore?: number | null;
    confidence?: number | null;
    overallStatus?: string | null;
    explanation?: string | null;
    recommendation?: string | null;
  } | null;
  trust?: {
    confidence?: number | null;
    decision?: string | null;
    reasonCode?: string | null;
  } | null;
  outcome?: {
    status?: string | null;
    reason?: string | null;
    reasonCode?: string | null;
    headline?: string | null;
    description?: string | null;
    timeline?: Array<{
      name?: string;
      status?: string;
      explanation?: string;
      engine?: string;
    }>;
  } | null;
  performance?: {
    processingMs?: number | null;
    aiMs?: number | null;
    ocrMs?: number | null;
  } | null;
  scfc?: {
    fingerprint?: string | null;
    tier?: string | null;
    status?: string | null;
    reason?: string | null;
  } | null;
};

const STAGE_LABELS: Record<VerificationTimelineStageId, string> = {
  received: "Received",
  ai: "AI",
  scfc: "SCFC",
  arc: "ARC",
  sir: "SIR",
  fse: "FSE",
  trust: "Trust",
  outcome: "Outcome",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseParsedFields(value: unknown): ParsedFields | null {
  if (!isRecord(value)) return null;
  return value as ParsedFields;
}

function parseLimit(value: unknown): number {
  const raw = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 25;
  return Math.min(100, Math.max(1, Math.floor(raw)));
}

function parseDays(value: unknown): VerificationDays {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "7") return 7;
  if (raw === "90") return 90;
  return 30;
}

function parseOptionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : null;
}

function parseBool(value: unknown): boolean {
  if (value === true || value === "true" || value === "1") return true;
  return false;
}

export function parseVerificationQuery(query: Record<string, unknown>): VerificationQuery {
  return {
    days: parseDays(query.days),
    limit: parseLimit(query.limit),
    cursor: typeof query.cursor === "string" && query.cursor.trim() ? query.cursor.trim() : null,
    outcome: parseOptionalEnum(query.outcome, [
      "SAVED",
      "NEEDS_REVIEW",
      "BLOCKED",
      "DUPLICATE",
      "NOT_FINANCIAL",
      "ERROR",
    ] as const),
    review: typeof query.review === "string" && query.review.trim() ? query.review.trim().toLowerCase() : null,
    supplier:
      query.supplier === "resolved" || query.supplier === "unknown"
        ? query.supplier
        : null,
    blocked: parseBool(query.blocked),
    duplicate: parseBool(query.duplicate),
    confidence:
      query.confidence === "low" || query.confidence === "medium" || query.confidence === "high"
        ? query.confidence
        : null,
    search: typeof query.search === "string" && query.search.trim() ? query.search.trim() : null,
  };
}

export function encodeVerificationCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeVerificationCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf("|");
    if (separator <= 0) return null;
    const createdAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function normalizeTimelineStatus(status: string | undefined): VerificationTimelineStage["status"] {
  if (
    status === "completed" ||
    status === "warning" ||
    status === "failed" ||
    status === "skipped" ||
    status === "pending"
  ) {
    return status;
  }
  return "unknown";
}

function stageConfidence(
  stageId: VerificationTimelineStageId,
  parsed: ParsedFields | null
): number | null {
  switch (stageId) {
    case "ai":
      return parsed?.confidence ?? null;
    case "arc":
      return parsed?.arc?.confidence ?? parsed?.arc?.evidenceScore ?? null;
    case "sir":
      return parsed?.sir?.confidence ?? parsed?.sir?.evidenceScore ?? null;
    case "fse":
      return parsed?.fse?.trustScore ?? parsed?.fse?.confidence ?? null;
    case "trust": {
      const value = parsed?.trust?.confidence ?? null;
      if (value == null) return null;
      return value > 1 ? value / 100 : value;
    }
    default:
      return null;
  }
}

function stageReason(stageId: VerificationTimelineStageId, parsed: ParsedFields | null): string | null {
  switch (stageId) {
    case "arc":
      return parsed?.arc?.reasonCode ?? parsed?.arc?.reason ?? parsed?.arc?.status ?? null;
    case "sir":
      return parsed?.sir?.reasonCode ?? parsed?.sir?.reason ?? parsed?.sir?.status ?? null;
    case "fse":
      return parsed?.fse?.recommendation ?? parsed?.fse?.overallStatus ?? parsed?.fse?.explanation ?? null;
    case "trust":
      return parsed?.trust?.reasonCode ?? parsed?.trust?.decision ?? null;
    case "outcome":
      return parsed?.outcome?.reasonCode ?? parsed?.outcome?.reason ?? parsed?.outcome?.status ?? null;
    case "ai":
      return parsed?.reasons?.slice(0, 2).join(", ") ?? null;
    case "scfc":
      return parsed?.scfc?.reason ?? parsed?.scfc?.tier ?? parsed?.scfc?.status ?? null;
    default:
      return null;
  }
}

function stageDuration(stageId: VerificationTimelineStageId, parsed: ParsedFields | null): number | null {
  switch (stageId) {
    case "received":
      return parsed?.performance?.ocrMs ?? null;
    case "ai":
      return parsed?.performance?.aiMs ?? null;
    case "outcome":
      return parsed?.performance?.processingMs ?? null;
    default:
      return null;
  }
}

function synthesizeTimeline(parsed: ParsedFields | null): VerificationTimelineStage[] {
  const stored = parsed?.outcome?.timeline ?? [];
  const stageIds = Object.keys(STAGE_LABELS) as VerificationTimelineStageId[];

  return stageIds.map((stageId) => {
    const storedStep = stored.find((step) => step.engine === stageId);
    return {
      id: stageId,
      label: STAGE_LABELS[stageId],
      status: normalizeTimelineStatus(storedStep?.status),
      confidence: stageConfidence(stageId, parsed),
      reason: stageReason(stageId, parsed),
      durationMs: stageDuration(stageId, parsed),
      summary: sanitizeFreeText(storedStep?.explanation ?? null),
    };
  });
}

function normalizeTrustConfidence(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

function matchesConfidenceFilter(
  trustConfidence: number | null,
  filter: VerificationConfidenceFilter
): boolean {
  if (trustConfidence == null) return filter === "low";
  if (filter === "low") return trustConfidence < 0.6;
  if (filter === "medium") return trustConfidence >= 0.6 && trustConfidence < 0.8;
  return trustConfidence >= 0.8;
}

function maskInvoiceNumber(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return maskInvoiceNumbers(value.trim());
}

function gmailMessageIdPrefix(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function mapVerificationDocument(input: {
  id: string;
  source: VerificationDocumentSummary["source"];
  createdAt: Date;
  amount?: number | null;
  supplierName?: string | null;
  documentType?: string | null;
  reviewStatus?: string | null;
  parsedFieldsJson?: unknown;
  gmailMessageId?: string | null;
}): VerificationDocumentSummary {
  const parsed = parseParsedFields(input.parsedFieldsJson);
  const analytics = mapAccuracyAnalyticsRow({
    id: input.id,
    amount: input.amount,
    supplierName: input.supplierName,
    reviewStatus: input.reviewStatus,
    parsedFieldsJson: input.parsedFieldsJson,
  });

  const supplier =
    sanitizeSupplierLabel(parsed?.sir?.canonicalSupplier ?? parsed?.sir?.supplierName ?? input.supplierName) ??
    null;

  return {
    documentId: input.id,
    source: input.source,
    createdAt: input.createdAt.toISOString(),
    supplier,
    amount: analytics.amount ?? null,
    documentType: input.documentType ?? null,
    reviewStatus: input.reviewStatus ?? null,
    outcomeStatus: analytics.outcomeStatus,
    trustConfidence: normalizeTrustConfidence(analytics.trustConfidence),
    arcConfidence: analytics.arcConfidence ?? null,
    sirConfidence: analytics.sirConfidence ?? null,
    fseTrust: analytics.fseTrustScore ?? null,
    goldenMatch: null,
    invoiceNumberMasked: maskInvoiceNumber(parsed?.invoiceNumber),
    gmailMessageIdPrefix: gmailMessageIdPrefix(input.gmailMessageId),
    timeline: synthesizeTimeline(parsed),
  };
}

function matchesDocumentFilters(
  doc: VerificationDocumentSummary,
  parsed: ParsedFields | null,
  query: VerificationQuery
): boolean {
  if (query.outcome && doc.outcomeStatus !== query.outcome) return false;
  if (query.review && (doc.reviewStatus ?? "").toLowerCase() !== query.review) return false;
  if (query.blocked && doc.outcomeStatus !== "BLOCKED" && doc.outcomeStatus !== "ERROR") return false;
  if (query.duplicate && doc.outcomeStatus !== "DUPLICATE") return false;
  if (query.supplier === "resolved" && parsed?.sir?.status !== "resolved") return false;
  if (query.supplier === "unknown" && parsed?.sir?.status === "resolved") return false;
  if (query.confidence && !matchesConfidenceFilter(doc.trustConfidence, query.confidence)) return false;
  return true;
}

export function verificationResponseContainsForbiddenFields(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = verificationResponseContainsForbiddenFields(item);
      if (nested) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) {
    if ((FORBIDDEN_VERIFICATION_RESPONSE_KEYS as readonly string[]).includes(key)) {
      return key;
    }
    const nested = verificationResponseContainsForbiddenFields(value[key]);
    if (nested) return nested;
  }
  return null;
}

export type VerificationDb = Pick<PrismaClient, "gmailScanItem">;

export async function loadVerificationDocuments(
  db: VerificationDb,
  organizationId: string,
  query: VerificationQuery,
  now: Date = new Date()
): Promise<{ documents: VerificationDocumentSummary[]; nextCursor: string | null }> {
  if (!organizationId.trim()) {
    throw new Error("organizationId is required");
  }

  const dateRange = buildAccuracyAnalyticsDateRange(query.days, now);
  const createdAtFilter = {
    gte: new Date(dateRange.from),
    lte: new Date(dateRange.to),
  };

  const cursor = query.cursor ? decodeVerificationCursor(query.cursor) : null;
  const searchNeedle = query.search?.toLowerCase() ?? null;

  const where = {
    organizationId,
    createdAt: createdAtFilter,
    ...(searchNeedle
      ? {
          OR: [
            { supplierName: { contains: query.search!, mode: "insensitive" as const } },
            { gmailMessageId: { contains: query.search!, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {}),
  };

  const batchSize = Math.min(250, Math.max(query.limit * 4, query.limit + 1));
  const rows = await db.gmailScanItem.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: batchSize,
    select: {
      id: true,
      createdAt: true,
      amount: true,
      supplierName: true,
      documentType: true,
      reviewStatus: true,
      parsedFieldsJson: true,
      gmailMessageId: true,
    },
  });

  const documents: VerificationDocumentSummary[] = [];
  let nextCursor: string | null = null;
  let lastScannedRow: (typeof rows)[number] | null = null;

  for (const row of rows) {
    lastScannedRow = row;
    const parsed = parseParsedFields(row.parsedFieldsJson);
    const mapped = mapVerificationDocument({
      id: `gsi:${row.id}`,
      source: "gmail_scan_item",
      createdAt: row.createdAt,
      amount: row.amount,
      supplierName: row.supplierName,
      documentType: row.documentType,
      reviewStatus: row.reviewStatus,
      parsedFieldsJson: row.parsedFieldsJson,
      gmailMessageId: row.gmailMessageId,
    });

    if (searchNeedle) {
      const invoiceHaystack = (parsed?.invoiceNumber ?? "").toLowerCase();
      const supplierHaystack = [mapped.supplier, parsed?.sir?.canonicalSupplier, parsed?.sir?.supplierName, row.supplierName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const gmailHaystack = row.gmailMessageId.toLowerCase();
      const matchesSearch =
        supplierHaystack.includes(searchNeedle) ||
        invoiceHaystack.includes(searchNeedle) ||
        gmailHaystack.includes(searchNeedle);
      if (!matchesSearch) continue;
    }

    if (!matchesDocumentFilters(mapped, parsed, query)) continue;

    documents.push(mapped);
    if (documents.length >= query.limit) {
      break;
    }
  }

  if (documents.length >= query.limit && lastScannedRow) {
    nextCursor = encodeVerificationCursor(lastScannedRow.createdAt, lastScannedRow.id);
  }

  return { documents, nextCursor };
}

export async function getVerificationCenterForOrganization(
  db: VerificationDb,
  organizationId: string,
  query: VerificationQuery,
  now: Date = new Date()
): Promise<VerificationCenterResponse> {
  const dateRange = buildAccuracyAnalyticsDateRange(query.days, now);
  const { documents, nextCursor } = await loadVerificationDocuments(db, organizationId, query, now);
  const sanitizedDocuments = sanitizeJsonValue(documents) as VerificationDocumentSummary[];

  const response: VerificationCenterResponse = {
    version: VERIFICATION_CENTER_VERSION,
    dateRange: {
      days: query.days,
      from: dateRange.from,
      to: dateRange.to,
    },
    documents: sanitizedDocuments,
    nextCursor,
    totalReturned: sanitizedDocuments.length,
  };

  const forbidden = verificationResponseContainsForbiddenFields(response);
  if (forbidden) {
    throw new Error(`verification response contains forbidden field: ${forbidden}`);
  }

  const serialized = JSON.stringify(response);
  if (containsLikelyPii(serialized)) {
    throw new Error("verification response contains likely PII");
  }

  return response;
}
