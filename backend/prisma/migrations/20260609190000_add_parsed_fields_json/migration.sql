-- Store OCR/extraction results without changing existing required amount columns.
ALTER TABLE "GmailScanItem" ADD COLUMN IF NOT EXISTS "parsed_fields_json" JSONB;
ALTER TABLE "FinancialDocumentReview" ADD COLUMN IF NOT EXISTS "parsed_fields_json" JSONB;
ALTER TABLE "SupplierPayment" ADD COLUMN IF NOT EXISTS "parsed_fields_json" JSONB;
