ALTER TABLE "SupplierPayment"
  ADD COLUMN IF NOT EXISTS "documentFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "documentTypeDetailed" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierTaxId" TEXT,
  ADD COLUMN IF NOT EXISTS "amountBeforeVat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "vatAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "totalAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "confidenceScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS "sourcesJson" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPayment_organizationId_documentFingerprint_key"
  ON "SupplierPayment"("organizationId", "documentFingerprint");

CREATE TABLE IF NOT EXISTS "FinancialDocumentReview" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sender" TEXT,
  "subject" TEXT,
  "fileName" TEXT,
  "fileSize" INTEGER,
  "sourceFingerprint" TEXT NOT NULL,
  "documentFingerprint" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "supplierName" TEXT,
  "supplierTaxId" TEXT,
  "invoiceNumber" TEXT,
  "documentDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "amountBeforeVat" DOUBLE PRECISION,
  "vatAmount" DOUBLE PRECISION,
  "totalAmount" DOUBLE PRECISION,
  "currency" TEXT NOT NULL DEFAULT 'ILS',
  "driveFileUrl" TEXT,
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reviewStatus" TEXT NOT NULL DEFAULT 'needs_review',
  "uncertaintyReason" TEXT,
  "rawAnalysis" JSONB,
  "emailMessageId" TEXT,
  "gmailMessageId" TEXT,
  "whatsappLogId" TEXT,
  "supplierPaymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialDocumentReview_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "FinancialDocumentReview"
    ADD CONSTRAINT "FinancialDocumentReview_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialDocumentReview_organizationId_documentFingerprint_key"
  ON "FinancialDocumentReview"("organizationId", "documentFingerprint");
CREATE INDEX IF NOT EXISTS "FinancialDocumentReview_organizationId_reviewStatus_createdAt_idx"
  ON "FinancialDocumentReview"("organizationId", "reviewStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "FinancialDocumentReview_organizationId_source_createdAt_idx"
  ON "FinancialDocumentReview"("organizationId", "source", "createdAt");
CREATE INDEX IF NOT EXISTS "FinancialDocumentReview_organizationId_sourceFingerprint_idx"
  ON "FinancialDocumentReview"("organizationId", "sourceFingerprint");
