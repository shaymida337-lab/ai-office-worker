CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "title" TEXT NOT NULL,
  "fileName" TEXT,
  "clientId" TEXT,
  "customerName" TEXT,
  "supplierName" TEXT,
  "supplierTaxId" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "storageLocation" TEXT,
  "driveUrl" TEXT,
  "driveFileId" TEXT,
  "createdById" TEXT,
  "createdByName" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "knowledge_documents_organizationId_idx"
  ON "knowledge_documents"("organizationId");

CREATE INDEX IF NOT EXISTS "knowledge_documents_organizationId_category_idx"
  ON "knowledge_documents"("organizationId", "category");

CREATE INDEX IF NOT EXISTS "knowledge_documents_organizationId_clientId_idx"
  ON "knowledge_documents"("organizationId", "clientId");

ALTER TABLE "knowledge_documents"
  ADD CONSTRAINT "knowledge_documents_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
