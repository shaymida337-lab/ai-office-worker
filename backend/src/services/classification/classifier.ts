export type MoneyDirection = "INCOMING" | "OUTGOING" | "UNSURE";
export type ClassifiedParty = "CUSTOMER" | "SUPPLIER" | "NONE";
export type SupplierReality = "REAL_SUPPLIER" | "BLOCKLISTED" | "UNSURE" | "NOT_APPLICABLE";
export type ClassificationDecision = "CLASSIFIED" | "NEEDS_REVIEW";

export type ClassificationInput = {
  sender?: string | null;
  subject?: string | null;
  body?: string | null;
  documentType?: string | null;
  supplierName?: string | null;
  customerName?: string | null;
  businessName?: string | null;
  issuedBy?: string | null;
  issuedTo?: string | null;
  paymentRequired?: boolean | null;
  channel?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ClassificationResult = {
  direction: MoneyDirection;
  party: ClassifiedParty;
  isRealSupplier: SupplierReality;
  decision: ClassificationDecision;
  reason: string;
};

export type PipelineClassificationAction = "SUPPLIER_EXPENSE" | "CUSTOMER_INVOICE" | "NEEDS_REVIEW";

const BLOCKLIST_PATTERNS = [
  /bank|בנק/i,
  /credit\s*card|כרטיס\s*אשראי|ישראכרט|ויזה|\bvisa\b|mastercard|amex|max\s*card|\bcal\b/i,
  /gov\.il|ממשלתי|רשות\s*המסים|ביטוח\s*לאומי/i,
];

const OUTGOING_PATTERNS = [
  /supplier\s+invoice|vendor\s+invoice|invoice\s+from|receipt\s+from|payment\s+demand|payment\s+request/i,
  /subscription|plan renewal|hardware|materials|professional service/i,
  /חשבונית\s+ספק|חשבונית\s+מאת|דרישת\s+תשלום|בקשת\s+תשלום|קבלה\s+מאת/i,
];

const INCOMING_PATTERNS = [
  /customer\s+invoice|sales\s+invoice|invoice\s+to|issued\s+to|bill\s+to|payment\s+received/i,
  /לקוח|חשבונית\s+לקוח|חשבונית\s+מכירה|התקבל\s+תשלום/i,
];

const REAL_SUPPLIER_PATTERNS = [
  /openai|netlify|vercel|render|github|hardware|materials|subscription|professional|store|supplier|vendor/i,
  /טמבור|חומרי\s+בניין|מנוי|ספק|חנות|שירות\s+מקצועי/i,
];

export function classifyBusinessDocument(input: ClassificationInput): ClassificationResult {
  const text = [
    input.sender,
    input.subject,
    input.body,
    input.documentType,
    input.supplierName,
    input.customerName,
    input.issuedBy,
    input.issuedTo,
  ].filter(Boolean).join("\n");

  if (isBlocklisted(text)) {
    return needsReview("blocklisted_not_supplier_or_customer", "UNSURE", "NONE", "BLOCKLISTED");
  }

  const businessName = normalize(input.businessName);
  const issuedBy = normalize(input.issuedBy);
  const issuedTo = normalize(input.issuedTo);
  const sender = normalize(input.sender);
  const supplier = normalize(input.supplierName);
  const customer = normalize(input.customerName);
  const hasOutgoingSignal = OUTGOING_PATTERNS.some((pattern) => pattern.test(text));

  const businessIssuedDocument = Boolean(businessName && issuedBy && issuedBy.includes(businessName));
  const documentIssuedToBusiness = Boolean(businessName && issuedTo && issuedTo.includes(businessName));
  const externalIssuer = Boolean((issuedBy || supplier) && !businessIssuedDocument && (documentIssuedToBusiness || hasOutgoingSignal));

  if (businessIssuedDocument || INCOMING_PATTERNS.some((pattern) => pattern.test(text))) {
    const hasCustomerSignal = Boolean(customer || issuedTo || /customer|לקוח/i.test(text));
    if (!hasCustomerSignal) {
      return needsReview("incoming_without_customer_identity", "INCOMING", "CUSTOMER", "NOT_APPLICABLE");
    }
    return {
      direction: "INCOMING",
      party: "CUSTOMER",
      isRealSupplier: "NOT_APPLICABLE",
      decision: "CLASSIFIED",
      reason: "business_issued_customer_document",
    };
  }

  if (documentIssuedToBusiness || hasOutgoingSignal || externalIssuer) {
    const supplierReality = classifySupplierReality(text);
    if (supplierReality !== "REAL_SUPPLIER") {
      return needsReview("outgoing_supplier_reality_unsure", "OUTGOING", "SUPPLIER", supplierReality);
    }
    return {
      direction: "OUTGOING",
      party: "SUPPLIER",
      isRealSupplier: "REAL_SUPPLIER",
      decision: "CLASSIFIED",
      reason: documentIssuedToBusiness ? "external_document_issued_to_business" : "external_supplier_document",
    };
  }

  return needsReview("money_direction_unsure", "UNSURE", "NONE", "UNSURE");
}

export function pipelineActionForClassification(result: ClassificationResult): PipelineClassificationAction {
  if (result.decision !== "CLASSIFIED") return "NEEDS_REVIEW";
  if (result.direction === "OUTGOING" && result.party === "SUPPLIER" && result.isRealSupplier === "REAL_SUPPLIER") {
    return "SUPPLIER_EXPENSE";
  }
  if (result.direction === "INCOMING" && result.party === "CUSTOMER") {
    return "CUSTOMER_INVOICE";
  }
  return "NEEDS_REVIEW";
}

function classifySupplierReality(text: string): SupplierReality {
  if (isBlocklisted(text)) return "BLOCKLISTED";
  if (REAL_SUPPLIER_PATTERNS.some((pattern) => pattern.test(text))) return "REAL_SUPPLIER";
  return "UNSURE";
}

function needsReview(
  reason: string,
  direction: MoneyDirection,
  party: ClassifiedParty,
  isRealSupplier: SupplierReality
): ClassificationResult {
  return {
    direction,
    party,
    isRealSupplier,
    decision: "NEEDS_REVIEW",
    reason,
  };
}

function isBlocklisted(text: string) {
  return BLOCKLIST_PATTERNS.some((pattern) => pattern.test(text));
}

function normalize(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}
