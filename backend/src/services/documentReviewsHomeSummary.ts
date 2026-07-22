/**
 * Lightweight document-reviews payload for dashboard home Background.
 * Same filter/order as the full list; no decision/readiness enrichment.
 */
import { prisma } from "../lib/prisma.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
  mergePrismaWhere,
} from "./p0/financialReadIsolation.js";

export const DOCUMENT_REVIEWS_HOME_SUMMARY_LIMIT = 5;

export const DOCUMENT_REVIEWS_HOME_SUMMARY_SELECT = {
  id: true,
  supplierName: true,
  sender: true,
  totalAmount: true,
  currency: true,
  documentDate: true,
  createdAt: true,
  reviewStatus: true,
  uncertaintyReason: true,
  documentType: true,
} as const;

export type DocumentReviewHomeSummaryItem = {
  id: string;
  supplierName: string | null;
  sender: string | null;
  totalAmount: number | null;
  currency: string | null;
  documentDate: string | null;
  createdAt: string;
  reviewStatus: string;
  uncertaintyReason: string | null;
  documentType: string;
};

export type DocumentReviewsHomeSummaryResponse = {
  count: number;
  items: DocumentReviewHomeSummaryItem[];
};

export function buildDocumentReviewsListWhere(
  organizationId: string,
  status: string,
  contaminatedGmailIds: string[],
) {
  return mergePrismaWhere(
    {
      organizationId,
      ...(status === "all" ? {} : { reviewStatus: status }),
    },
    buildFinancialDocumentReviewReadIsolationWhere(organizationId, contaminatedGmailIds),
  );
}

export function mapDocumentReviewHomeSummaryItem(item: {
  id: string;
  supplierName: string | null;
  sender: string | null;
  totalAmount: number | null;
  currency: string;
  documentDate: Date | null;
  createdAt: Date;
  reviewStatus: string;
  uncertaintyReason: string | null;
  documentType: string;
}): DocumentReviewHomeSummaryItem {
  return {
    id: item.id,
    supplierName: item.supplierName,
    sender: item.sender,
    totalAmount: item.totalAmount,
    currency: item.currency ?? null,
    documentDate: item.documentDate ? item.documentDate.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    reviewStatus: item.reviewStatus,
    uncertaintyReason: item.uncertaintyReason,
    documentType: item.documentType,
  };
}

export function assertDocumentReviewHomeSummaryShape(payload: DocumentReviewsHomeSummaryResponse) {
  if (!Number.isFinite(payload.count) || payload.count < 0) {
    throw new Error("summary count must be a non-negative number");
  }
  if (!Array.isArray(payload.items)) {
    throw new Error("summary items must be an array");
  }
  if (payload.items.length > DOCUMENT_REVIEWS_HOME_SUMMARY_LIMIT) {
    throw new Error(`summary items must be <= ${DOCUMENT_REVIEWS_HOME_SUMMARY_LIMIT}`);
  }
  const allowed = new Set(Object.keys(DOCUMENT_REVIEWS_HOME_SUMMARY_SELECT));
  for (const item of payload.items) {
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) {
        throw new Error(`summary item has unexpected field: ${key}`);
      }
    }
  }
}

/**
 * Same status/isolation/order as GET /document-reviews full list,
 * but count + take 5 slim rows and no buildReviewDecision.
 */
export async function getDocumentReviewsHomeSummary(params: {
  organizationId: string;
  status?: string;
}): Promise<DocumentReviewsHomeSummaryResponse> {
  const status = params.status && params.status.length > 0 ? params.status : "needs_review";
  const contaminatedGmailIds = await loadCrossOrgContaminatedGmailIdsForReads();
  const where = buildDocumentReviewsListWhere(params.organizationId, status, contaminatedGmailIds);

  const [count, rows] = await Promise.all([
    prisma.financialDocumentReview.count({ where }),
    prisma.financialDocumentReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: DOCUMENT_REVIEWS_HOME_SUMMARY_LIMIT,
      select: DOCUMENT_REVIEWS_HOME_SUMMARY_SELECT,
    }),
  ]);

  const payload = {
    count,
    items: rows.map(mapDocumentReviewHomeSummaryItem),
  };
  assertDocumentReviewHomeSummaryShape(payload);
  return payload;
}
