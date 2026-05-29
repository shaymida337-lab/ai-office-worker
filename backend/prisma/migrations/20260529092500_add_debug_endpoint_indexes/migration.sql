CREATE INDEX IF NOT EXISTS "SupplierPayment_organizationId_createdAt_idx"
ON "SupplierPayment"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "Invoice_organizationId_createdAt_idx"
ON "Invoice"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "GmailScanItem_organizationId_createdAt_idx"
ON "GmailScanItem"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "GmailScanItem_organizationId_documentType_createdAt_idx"
ON "GmailScanItem"("organizationId", "documentType", "createdAt");

CREATE INDEX IF NOT EXISTS "GmailScanItem_organizationId_reviewStatus_createdAt_idx"
ON "GmailScanItem"("organizationId", "reviewStatus", "createdAt");
