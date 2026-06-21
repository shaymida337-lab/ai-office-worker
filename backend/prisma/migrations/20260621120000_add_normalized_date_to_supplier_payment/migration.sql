-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN "normalizedDocumentDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_normalizedDocumentDate_idx" ON "SupplierPayment"("organizationId", "normalizedDocumentDate");
