export type SttConfidenceLevel = "high" | "medium" | "low";

export type SttCorrectionKind =
  | "client_name"
  | "supplier_name"
  | "hebrew_number"
  | "phone_digits"
  | "business_term"
  | "vocabulary";

export type SttCorrection = {
  kind: SttCorrectionKind;
  original: string;
  corrected: string;
  confidence: number;
  ambiguous: boolean;
};

export type SttVocabulary = {
  organizationId: string;
  organizationName: string | null;
  clientNames: string[];
  supplierNames: string[];
  serviceNames: string[];
  memberNames: string[];
  businessTerms: string[];
};

export type SttAccuracyResult = {
  rawTranscript: string;
  normalizedTranscript: string;
  confidence: number;
  confidenceLevel: SttConfidenceLevel;
  corrections: SttCorrection[];
  clarificationRequired: boolean;
  clarificationMessage: string | null;
  actionBlocked: boolean;
  detectedActions: string[];
  ambiguousNameSuggestions: string[];
};
