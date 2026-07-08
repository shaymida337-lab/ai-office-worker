/**
 * Knowledge Center shared types (Phase 1).
 *
 * The knowledge repository is the single source of truth for business
 * documents (contracts, agreements, warranties, quotations, manuals, licenses,
 * certificates, and other files). These types are shared by the repository,
 * search service, intent parser, and the API/brain layers so every channel
 * (chat, voice, WhatsApp) speaks the same shape.
 */

export const KNOWLEDGE_CATEGORIES = [
  "contract",
  "agreement",
  "warranty",
  "quotation",
  "manual",
  "license",
  "certificate",
  "other",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export function isKnowledgeCategory(value: string): value is KnowledgeCategory {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

/** Hebrew label for a category, used in user-facing messages. */
export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  contract: "חוזה",
  agreement: "הסכם",
  warranty: "אחריות",
  quotation: "הצעת מחיר",
  manual: "מדריך",
  license: "רישיון",
  certificate: "תעודה",
  other: "מסמך",
};

/** Plural Hebrew label for a category. */
export const KNOWLEDGE_CATEGORY_LABELS_PLURAL: Record<KnowledgeCategory, string> = {
  contract: "חוזים",
  agreement: "הסכמים",
  warranty: "כתבי אחריות",
  quotation: "הצעות מחיר",
  manual: "מדריכים",
  license: "רישיונות",
  certificate: "תעודות",
  other: "מסמכים",
};

/** Normalized, channel-agnostic view of a stored document. */
export type KnowledgeDocumentSummary = {
  id: string;
  title: string;
  category: KnowledgeCategory;
  fileName: string | null;
  customerName: string | null;
  supplierName: string | null;
  tags: string[];
  driveUrl: string | null;
  storageLocation: string | null;
  uploadedAt: string;
};
