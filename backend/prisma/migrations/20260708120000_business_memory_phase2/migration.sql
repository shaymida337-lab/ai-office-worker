-- Natalie Business Memory Phase 2: source routing + extensible metadata

ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "knowledge_documents_organizationId_source_idx"
  ON "knowledge_documents"("organizationId", "source");

CREATE INDEX IF NOT EXISTS "knowledge_documents_organizationId_driveFileId_idx"
  ON "knowledge_documents"("organizationId", "driveFileId");

-- Prevent duplicate Drive file registration per organization (metadata sync only).
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_documents_org_drive_file_unique"
  ON "knowledge_documents"("organizationId", "driveFileId")
  WHERE "driveFileId" IS NOT NULL;
