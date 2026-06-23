export const SIR_VERSION = "sir-v1" as const;

export type SupplierResolutionStatus = "resolved" | "ambiguous" | "missing" | "rejected";

export type SupplierCandidateKind =
  | "user_corrected"
  | "vat_registry"
  | "document_labeled"
  | "ocr_keyword"
  | "historical"
  | "ai_extracted"
  | "brand_alias"
  | "email_domain"
  | "sender_display"
  | "phone"
  | "address"
  | "unknown";

export type SupplierCandidateSource =
  | "claude_file"
  | "claude_email"
  | "regex_gmail"
  | "ocr_keyword"
  | "parsed_fields_json"
  | "sender"
  | "domain"
  | "registry"
  | "learning"
  | "user_input"
  | "reprocess";

export type SupplierReasonCode =
  | "USER_CORRECTED"
  | "VAT_REGISTRY"
  | "DOCUMENT_LABELED"
  | "OCR_KEYWORD"
  | "HISTORICAL_MATCH"
  | "AI_EXTRACTED"
  | "BRAND_ALIAS"
  | "SENDER_DISPLAY"
  | "EMAIL_DOMAIN"
  | "MULTIPLE_ENTITIES"
  | "BLOCKLISTED"
  | "MISSING"
  | "REJECTED_INVALID"
  | "AMBIGUOUS";

export type SupplierEvidenceType =
  | "logo"
  | "vat"
  | "business_number"
  | "email_domain"
  | "website"
  | "phone"
  | "address"
  | "invoice_layout"
  | "historical"
  | "correction"
  | "claude"
  | "ocr"
  | "regex"
  | "brand_alias"
  | "document_template";

export type SupplierCandidate = {
  name: string;
  kind: SupplierCandidateKind;
  source: SupplierCandidateSource;
  vatNumber?: string | null;
  confidence?: number | null;
  label?: string | null;
  raw?: string | null;
};

export type RankedSupplierCandidate = SupplierCandidate & {
  tier: number;
  score: number;
  normalizedName: string;
};

export type RejectedSupplierCandidate = SupplierCandidate & {
  reason: string;
};

export type SupplierEvidenceItem = {
  type: SupplierEvidenceType;
  label: string;
  value: string;
  weight: number;
  matched: boolean;
  source?: string | null;
};

export type SupplierDNACategory =
  | "utility"
  | "government"
  | "retail"
  | "saas"
  | "bank"
  | "marketplace"
  | "other";

export type SupplierDNA = {
  canonicalSupplier: string;
  canonicalName: string;
  normalizedName: string;
  aliases: string[];
  ocrVariants: string[];
  vatNumber: string | null;
  emailDomains: string[];
  knownEmails: string[];
  knownPhones: string[];
  category: SupplierDNACategory;
  isBlocklisted: boolean;
  typicalLanguage: "he" | "en" | "mixed";
  typicalCurrency: string;
  historicalConfidence: number;
  correctionsCount: number;
  invoicesCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type SupplierDecision = {
  supplierName: string | null;
  canonicalSupplier: string | null;
  normalizedName: string;
  vatNumber: string | null;
  domains: string[];
  emails: string[];
  phones: string[];
  aliases: string[];
  logo: null;
  confidence: number;
  evidenceScore: number;
  reason: string;
  reasonCode: SupplierReasonCode;
  evidence: SupplierEvidenceItem[];
  candidates: RankedSupplierCandidate[];
  rejected: RejectedSupplierCandidate[];
  status: SupplierResolutionStatus;
  ambiguityFlags: string[];
  version: typeof SIR_VERSION;
  isStrongEnoughForAutoSave: boolean;
};

export type CanonicalSupplierInput = {
  organizationId: string;
  channel: string;
  candidates: SupplierCandidate[];
  registry?: SupplierDNA[];
  ownerEmails?: Set<string>;
};
