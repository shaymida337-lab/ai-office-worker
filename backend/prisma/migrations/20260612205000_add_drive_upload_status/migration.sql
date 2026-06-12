ALTER TABLE "EmailAttachment"
  ADD COLUMN IF NOT EXISTS "driveUploadStatus" TEXT;

ALTER TABLE "GmailScanItem"
  ADD COLUMN IF NOT EXISTS "driveUploadStatus" TEXT;

ALTER TABLE "FinancialDocumentReview"
  ADD COLUMN IF NOT EXISTS "driveUploadStatus" TEXT;

ALTER TABLE "SupplierPayment"
  ADD COLUMN IF NOT EXISTS "driveUploadStatus" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "driveUploadStatus" TEXT;
