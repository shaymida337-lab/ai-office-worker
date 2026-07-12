export type InvoiceDocumentSource = "gmail" | "whatsapp" | "camera" | "manual";

export type InvoiceDocumentType =
  | "invoice"
  | "receipt"
  | "tax_invoice"
  | "tax_invoice_receipt"
  | "payment_request";

export type InvoiceDocumentStatus =
  | "RECEIVED"
  | "CLASSIFYING"
  | "NOT_FINANCIAL"
  | "EXTRACTED"
  | "NEEDS_COMPLETION"
  | "NEEDS_APPROVAL"
  | "APPROVED"
  | "REJECTED";

export type ValidationIssue =
  | "MISSING_SUPPLIER"
  | "MISSING_AMOUNT"
  | "MISSING_DATE"
  | "MISSING_DOCUMENT_TYPE"
  | "MISSING_CURRENCY"
  | "LOW_CONFIDENCE_SUPPLIER"
  | "LOW_CONFIDENCE_AMOUNT"
  | "LOW_CONFIDENCE_DATE"
  | "LOW_CONFIDENCE_DOCUMENT_TYPE"
  | "LOW_CONFIDENCE_CURRENCY"
  | "DUPLICATE"
  | "AMOUNT_ANOMALY"
  | "SUPPLIER_PLACEHOLDER"
  | "NOT_FINANCIAL_UNCERTAIN"
  | "PROCESSING_ERROR";

export type ConfidenceByField = {
  supplierName: number;
  totalAmount: number;
  documentDate: number;
  documentType: number;
  currency: number;
  invoiceNumber: number;
};

export type InvoiceDocument = {
  id: string;
  organizationId: string;
  source: InvoiceDocumentSource;
  sourceMessageId: string;
  attachmentHash: string;
  supplierName: string | null;
  totalAmount: number | null;
  documentDate: string | null;
  documentType: InvoiceDocumentType | null;
  currency: string | null;
  invoiceNumber: string | null;
  confidenceByField: ConfidenceByField;
  validationIssues: ValidationIssue[];
  status: InvoiceDocumentStatus;
  originalFileUrl: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  extractionVersion: string;
  createdAt: string;
  updatedAt: string;
  processingAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastProcessedAt: string | null;
};

const DOCUMENT_TYPES = new Set<InvoiceDocumentType>([
  "invoice",
  "receipt",
  "tax_invoice",
  "tax_invoice_receipt",
  "payment_request",
]);

const FINAL_STATUSES = new Set<InvoiceDocumentStatus>(["NOT_FINANCIAL", "APPROVED", "REJECTED"]);

const ALLOWED_TRANSITIONS: Record<InvoiceDocumentStatus, readonly InvoiceDocumentStatus[]> = {
  RECEIVED: ["CLASSIFYING"],
  CLASSIFYING: ["NOT_FINANCIAL", "EXTRACTED", "NEEDS_COMPLETION", "NEEDS_APPROVAL", "APPROVED"],
  EXTRACTED: ["NEEDS_COMPLETION", "NEEDS_APPROVAL", "APPROVED", "REJECTED"],
  NEEDS_COMPLETION: ["NEEDS_APPROVAL", "APPROVED", "REJECTED"],
  NEEDS_APPROVAL: ["APPROVED", "REJECTED"],
  NOT_FINANCIAL: [],
  APPROVED: [],
  REJECTED: [],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO4217_PATTERN = /^[A-Z]{3}$/;

function isEmailLike(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

function hasValidSupplier(supplierName: string | null): boolean {
  const cleaned = supplierName?.trim() ?? "";
  if (!cleaned) return false;
  return !isEmailLike(cleaned);
}

function hasValidAmount(totalAmount: number | null): boolean {
  return typeof totalAmount === "number" && Number.isFinite(totalAmount) && totalAmount > 0;
}

function hasValidDocumentDate(documentDate: string | null): boolean {
  if (!documentDate?.trim()) return false;
  const parsed = new Date(documentDate);
  return !Number.isNaN(parsed.getTime());
}

function hasValidDocumentType(documentType: InvoiceDocumentType | null): boolean {
  return documentType !== null && DOCUMENT_TYPES.has(documentType);
}

function hasValidCurrency(currency: string | null): boolean {
  const cleaned = currency?.trim().toUpperCase() ?? "";
  return cleaned.length > 0 && ISO4217_PATTERN.test(cleaned);
}

const LOW_CONFIDENCE_FIELDS: Array<{
  field: keyof ConfidenceByField;
  lowConfidenceIssue: ValidationIssue;
  isPresent: (document: InvoiceDocument) => boolean;
}> = [
  {
    field: "supplierName",
    lowConfidenceIssue: "LOW_CONFIDENCE_SUPPLIER",
    isPresent: (document) => hasValidSupplier(document.supplierName),
  },
  {
    field: "totalAmount",
    lowConfidenceIssue: "LOW_CONFIDENCE_AMOUNT",
    isPresent: (document) => hasValidAmount(document.totalAmount),
  },
  {
    field: "documentDate",
    lowConfidenceIssue: "LOW_CONFIDENCE_DATE",
    isPresent: (document) => hasValidDocumentDate(document.documentDate),
  },
  {
    field: "documentType",
    lowConfidenceIssue: "LOW_CONFIDENCE_DOCUMENT_TYPE",
    isPresent: (document) => hasValidDocumentType(document.documentType),
  },
];

const PASSTHROUGH_ISSUES: ValidationIssue[] = [
  "DUPLICATE",
  "AMOUNT_ANOMALY",
  "NOT_FINANCIAL_UNCERTAIN",
  "PROCESSING_ERROR",
];

export type ValidateInvoiceDocumentOptions = {
  /** Required for confidence-based auto-approval; no default per contract §4.3. */
  fieldConfidenceThreshold?: number;
};

export type ValidateInvoiceDocumentResult = {
  validationIssues: ValidationIssue[];
  dataComplete: boolean;
  canAutoApprove: boolean;
  nextStatus: InvoiceDocumentStatus;
};

export type ApproveFieldUpdates = Partial<
  Pick<
    InvoiceDocument,
    "supplierName" | "totalAmount" | "documentDate" | "documentType" | "currency" | "invoiceNumber"
  >
>;

export type TransitionAction =
  | { kind: "start_processing" }
  | { kind: "mark_not_financial" }
  | { kind: "mark_extracted" }
  | { kind: "run_validation"; options?: ValidateInvoiceDocumentOptions }
  | { kind: "approve"; approvedBy: string; fields?: ApproveFieldUpdates; options?: ValidateInvoiceDocumentOptions }
  | { kind: "reject" }
  | { kind: "retry" };

export type TransitionOptions = {
  now?: () => string;
};

export type TransitionResult =
  | { ok: true; document: InvoiceDocument }
  | { ok: false; error: string; code: "INVALID_TRANSITION" | "FINAL_STATUS" };

function uniqueIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...new Set(issues)];
}

function isConfidenceSufficient(score: number, threshold: number): boolean {
  return Number.isFinite(score) && score >= threshold;
}

function isClassifiedAsNotFinancial(document: InvoiceDocument): boolean {
  return (
    document.status === "NOT_FINANCIAL" ||
    document.validationIssues.includes("NOT_FINANCIAL_UNCERTAIN")
  );
}

function hasUncertaintyIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) =>
    issue.startsWith("LOW_CONFIDENCE_") ||
    issue === "AMOUNT_ANOMALY" ||
    issue === "DUPLICATE" ||
    issue === "SUPPLIER_PLACEHOLDER" ||
    issue === "NOT_FINANCIAL_UNCERTAIN" ||
    issue === "PROCESSING_ERROR"
  );
}

function isDataComplete(issues: ValidationIssue[]): boolean {
  if (issues.some((issue) => issue.startsWith("MISSING_"))) return false;
  if (issues.includes("SUPPLIER_PLACEHOLDER")) return false;
  return true;
}

function collectPassthroughIssues(document: InvoiceDocument): ValidationIssue[] {
  return PASSTHROUGH_ISSUES.filter((issue) => document.validationIssues.includes(issue));
}

export function validateInvoiceDocument(
  document: InvoiceDocument,
  options: ValidateInvoiceDocumentOptions = {}
): ValidateInvoiceDocumentResult {
  const threshold = options.fieldConfidenceThreshold;
  const issues: ValidationIssue[] = [...collectPassthroughIssues(document)];

  if (isClassifiedAsNotFinancial(document)) {
    if (!issues.includes("NOT_FINANCIAL_UNCERTAIN")) {
      issues.push("NOT_FINANCIAL_UNCERTAIN");
    }
    return {
      validationIssues: uniqueIssues(issues),
      dataComplete: false,
      canAutoApprove: false,
      nextStatus: "NOT_FINANCIAL",
    };
  }

  const supplier = document.supplierName?.trim() ?? "";
  if (!supplier) {
    issues.push("MISSING_SUPPLIER");
  } else if (isEmailLike(supplier)) {
    issues.push("SUPPLIER_PLACEHOLDER");
  }

  if (!hasValidAmount(document.totalAmount)) {
    issues.push("MISSING_AMOUNT");
  }

  if (!hasValidDocumentDate(document.documentDate)) {
    issues.push("MISSING_DATE");
  }

  if (!hasValidDocumentType(document.documentType)) {
    issues.push("MISSING_DOCUMENT_TYPE");
  }

  if (!hasValidCurrency(document.currency)) {
    issues.push("MISSING_CURRENCY");
  } else if (threshold !== undefined && !isConfidenceSufficient(document.confidenceByField.currency, threshold)) {
    issues.push("MISSING_CURRENCY");
  }

  if (threshold !== undefined) {
    for (const { field, lowConfidenceIssue, isPresent } of LOW_CONFIDENCE_FIELDS) {
      if (isPresent(document) && !isConfidenceSufficient(document.confidenceByField[field], threshold)) {
        issues.push(lowConfidenceIssue);
      }
    }
  }

  const validationIssues = uniqueIssues(issues);
  const dataComplete = isDataComplete(validationIssues);
  const canAutoApprove =
    threshold !== undefined &&
    dataComplete &&
    !hasUncertaintyIssues(validationIssues) &&
    hasValidSupplier(document.supplierName);

  let nextStatus: InvoiceDocumentStatus;
  if (!dataComplete) {
    nextStatus = "NEEDS_COMPLETION";
  } else if (canAutoApprove) {
    nextStatus = "APPROVED";
  } else {
    nextStatus = "NEEDS_APPROVAL";
  }

  return {
    validationIssues,
    dataComplete,
    canAutoApprove,
    nextStatus,
  };
}

function canTransition(from: InvoiceDocumentStatus, to: InvoiceDocumentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function applyApprovalInvariants(
  document: InvoiceDocument,
  status: InvoiceDocumentStatus,
  now: () => string,
  approvedBy?: string
): InvoiceDocument {
  const timestamp = now();
  if (status === "APPROVED") {
    return {
      ...document,
      status,
      approvedAt: timestamp,
      approvedBy: approvedBy ?? "system",
      updatedAt: timestamp,
    };
  }

  return {
    ...document,
    status,
    approvedAt: null,
    approvedBy: null,
    updatedAt: timestamp,
  };
}

function mergeApproveFields(document: InvoiceDocument, fields?: ApproveFieldUpdates): InvoiceDocument {
  if (!fields) return document;

  return {
    ...document,
    supplierName: fields.supplierName !== undefined ? fields.supplierName : document.supplierName,
    totalAmount: fields.totalAmount !== undefined ? fields.totalAmount : document.totalAmount,
    documentDate: fields.documentDate !== undefined ? fields.documentDate : document.documentDate,
    documentType: fields.documentType !== undefined ? fields.documentType : document.documentType,
    currency: fields.currency !== undefined ? fields.currency : document.currency,
    invoiceNumber: fields.invoiceNumber !== undefined ? fields.invoiceNumber : document.invoiceNumber,
  };
}

function transitionTo(
  document: InvoiceDocument,
  target: InvoiceDocumentStatus,
  now: () => string,
  approvedBy?: string
): TransitionResult {
  if (FINAL_STATUSES.has(document.status)) {
    return { ok: false, error: `Cannot transition from final status ${document.status}`, code: "FINAL_STATUS" };
  }

  if (!canTransition(document.status, target)) {
    return {
      ok: false,
      error: `Transition ${document.status} -> ${target} is not allowed`,
      code: "INVALID_TRANSITION",
    };
  }

  if (target === "APPROVED") {
    return {
      ok: false,
      error: "APPROVED requires run_validation or approve action",
      code: "INVALID_TRANSITION",
    };
  }

  return {
    ok: true,
    document: applyApprovalInvariants(document, target, now, approvedBy),
  };
}

function transitionToApproved(
  document: InvoiceDocument,
  now: () => string,
  approvedBy: string
): TransitionResult {
  if (FINAL_STATUSES.has(document.status)) {
    return { ok: false, error: `Cannot transition from final status ${document.status}`, code: "FINAL_STATUS" };
  }

  if (!canTransition(document.status, "APPROVED")) {
    return {
      ok: false,
      error: `Transition ${document.status} -> APPROVED is not allowed`,
      code: "INVALID_TRANSITION",
    };
  }

  return {
    ok: true,
    document: applyApprovalInvariants(document, "APPROVED", now, approvedBy),
  };
}

export function transitionInvoiceDocument(
  document: InvoiceDocument,
  requestedAction: TransitionAction,
  options: TransitionOptions = {}
): TransitionResult {
  const now = options.now ?? (() => new Date().toISOString());

  switch (requestedAction.kind) {
    case "start_processing":
      return transitionTo(document, "CLASSIFYING", now);

    case "mark_not_financial":
      return transitionTo(document, "NOT_FINANCIAL", now);

    case "mark_extracted":
      return transitionTo(document, "EXTRACTED", now);

    case "run_validation": {
      if (document.status !== "EXTRACTED" && document.status !== "CLASSIFYING") {
        return {
          ok: false,
          error: `run_validation is only allowed from EXTRACTED or CLASSIFYING, got ${document.status}`,
          code: "INVALID_TRANSITION",
        };
      }

      const validation = validateInvoiceDocument(document, requestedAction.options);
      if (validation.nextStatus === "EXTRACTED") {
        return {
          ok: false,
          error: "Validation cannot leave document in EXTRACTED",
          code: "INVALID_TRANSITION",
        };
      }

      const validatedDocument: InvoiceDocument = {
        ...document,
        validationIssues: validation.validationIssues,
        updatedAt: now(),
      };

      if (validation.nextStatus === "APPROVED") {
        if (!validation.canAutoApprove) {
          return {
            ok: false,
            error: "Auto-approval requires calibrated confidence thresholds and full validation",
            code: "INVALID_TRANSITION",
          };
        }
        return transitionToApproved(validatedDocument, now, "system");
      }

      return transitionTo(validatedDocument, validation.nextStatus, now);
    }

    case "approve": {
      if (!["NEEDS_APPROVAL", "NEEDS_COMPLETION", "EXTRACTED"].includes(document.status)) {
        return {
          ok: false,
          error: `approve is not allowed from status ${document.status}`,
          code: "INVALID_TRANSITION",
        };
      }

      const merged = mergeApproveFields(document, requestedAction.fields);
      const validation = validateInvoiceDocument(merged, requestedAction.options);

      const reviewedDocument: InvoiceDocument = {
        ...merged,
        validationIssues: validation.validationIssues,
      };

      if (validation.nextStatus === "APPROVED" && validation.canAutoApprove) {
        return transitionToApproved(reviewedDocument, now, requestedAction.approvedBy);
      }

      return transitionTo(reviewedDocument, validation.nextStatus, now);
    }

    case "reject": {
      if (!["NEEDS_APPROVAL", "NEEDS_COMPLETION", "EXTRACTED"].includes(document.status)) {
        return {
          ok: false,
          error: `reject is not allowed from status ${document.status}`,
          code: "INVALID_TRANSITION",
        };
      }
      return transitionTo(document, "REJECTED", now);
    }

    case "retry": {
      if (FINAL_STATUSES.has(document.status)) {
        return {
          ok: false,
          error: `retry is not allowed from final status ${document.status}`,
          code: "FINAL_STATUS",
        };
      }

      return {
        ok: true,
        document: {
          ...document,
          processingAttempts: document.processingAttempts + 1,
          lastProcessedAt: now(),
          updatedAt: now(),
        },
      };
    }

    default: {
      const _exhaustive: never = requestedAction;
      return _exhaustive;
    }
  }
}

export function buildIdempotencyKey(
  document: Pick<InvoiceDocument, "organizationId" | "source" | "sourceMessageId" | "attachmentHash">
): string {
  return `${document.organizationId}:${document.source}:${document.sourceMessageId}:${document.attachmentHash}`;
}
