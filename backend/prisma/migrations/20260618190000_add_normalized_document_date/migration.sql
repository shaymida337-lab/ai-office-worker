-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "normalizedDocumentDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FinancialDocumentReview" ADD COLUMN "normalizedDocumentDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GmailScanItem" ADD COLUMN "normalizedDocumentDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Invoice_organizationId_normalizedDocumentDate_idx" ON "Invoice"("organizationId", "normalizedDocumentDate");

-- CreateIndex
CREATE INDEX "FinancialDocumentReview_organizationId_normalizedDocumentDa_idx" ON "FinancialDocumentReview"("organizationId", "normalizedDocumentDate");

-- CreateIndex
CREATE INDEX "GmailScanItem_organizationId_normalizedDocumentDate_idx" ON "GmailScanItem"("organizationId", "normalizedDocumentDate");
