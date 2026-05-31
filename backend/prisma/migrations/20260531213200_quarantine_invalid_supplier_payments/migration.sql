WITH invalid_payments AS (
  SELECT *
  FROM "SupplierPayment"
  WHERE
    "approvalStatus" = 'approved'
    AND (
      "supplier" IS NULL
      OR btrim("supplier") = ''
      OR lower(btrim("supplier")) IN ('unknown', 'unknown supplier', 'לא ידוע', 'לא מזוהה', 'n/a', 'null', 'undefined', '.name')
      OR btrim("supplier") LIKE '.%'
      OR btrim("supplier") ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR btrim("supplier") ~* '^[[:alnum:]_.-]+\.[a-z]{2,}$'
      OR "invoiceNumber" IS NULL
      OR btrim("invoiceNumber") = ''
      OR "amount" IS NULL
      OR "amount" <= 0
      OR "date" IS NULL
      OR "source" IS NULL
      OR btrim("source") = ''
    )
)
INSERT INTO "FinancialDocumentReview" (
  "id",
  "organizationId",
  "source",
  "sender",
  "subject",
  "sourceFingerprint",
  "documentFingerprint",
  "documentType",
  "supplierName",
  "supplierTaxId",
  "invoiceNumber",
  "documentDate",
  "dueDate",
  "amountBeforeVat",
  "vatAmount",
  "totalAmount",
  "currency",
  "driveFileUrl",
  "confidenceScore",
  "reviewStatus",
  "uncertaintyReason",
  "emailMessageId",
  "supplierPaymentId",
  "createdAt",
  "updatedAt"
)
SELECT
  'review_' || substr(md5(ip."id" || ':' || ip."organizationId"), 1, 20),
  ip."organizationId",
  ip."source",
  ip."emailSender",
  ip."subject",
  COALESCE(ip."sourceFingerprint", md5(ip."organizationId" || ':' || ip."id" || ':source')),
  COALESCE(ip."documentFingerprint", ip."duplicateHash", md5(ip."organizationId" || ':' || ip."id" || ':document')),
  COALESCE(ip."documentTypeDetailed", 'tax_invoice'),
  ip."supplier",
  ip."supplierTaxId",
  ip."invoiceNumber",
  ip."date",
  ip."dueDate",
  ip."amountBeforeVat",
  ip."vatAmount",
  COALESCE(ip."totalAmount", ip."amount"),
  ip."currency",
  COALESCE(ip."driveFileUrl", ip."invoiceLink", ip."documentLink"),
  COALESCE(ip."confidenceScore", 0),
  'needs_review',
  'Existing supplier payment quarantined: invalid or missing required invoice fields',
  ip."emailMessageId",
  ip."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM invalid_payments ip
ON CONFLICT ("organizationId", "documentFingerprint") DO UPDATE SET
  "reviewStatus" = 'needs_review',
  "uncertaintyReason" = EXCLUDED."uncertaintyReason",
  "supplierPaymentId" = EXCLUDED."supplierPaymentId",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "SupplierPayment"
SET
  "approvalStatus" = 'needs_review',
  "duplicateDetected" = true,
  "duplicateReason" = COALESCE("duplicateReason", 'quarantined_invalid_required_invoice_fields'),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "approvalStatus" = 'approved'
  AND (
    "supplier" IS NULL
    OR btrim("supplier") = ''
    OR lower(btrim("supplier")) IN ('unknown', 'unknown supplier', 'לא ידוע', 'לא מזוהה', 'n/a', 'null', 'undefined', '.name')
    OR btrim("supplier") LIKE '.%'
    OR btrim("supplier") ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR btrim("supplier") ~* '^[[:alnum:]_.-]+\.[a-z]{2,}$'
    OR "invoiceNumber" IS NULL
    OR btrim("invoiceNumber") = ''
    OR "amount" IS NULL
    OR "amount" <= 0
    OR "date" IS NULL
    OR "source" IS NULL
    OR btrim("source") = ''
  );
