-- Phase 2.4 — immutable platform audit log (append-only)

CREATE TABLE IF NOT EXISTS "PlatformAuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "correlationId" TEXT,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "sourceModule" TEXT NOT NULL,
  "sourceRoute" TEXT,
  "beforeState" JSONB,
  "afterState" JSONB,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_createdAt_idx"
  ON "PlatformAuditLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_entityType_entityId_idx"
  ON "PlatformAuditLog"("organizationId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_correlationId_idx"
  ON "PlatformAuditLog"("organizationId", "correlationId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_action_idx"
  ON "PlatformAuditLog"("organizationId", "action");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_actorId_idx"
  ON "PlatformAuditLog"("organizationId", "actorId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_organizationId_severity_idx"
  ON "PlatformAuditLog"("organizationId", "severity");

DO $$ BEGIN
  ALTER TABLE "PlatformAuditLog"
    ADD CONSTRAINT "PlatformAuditLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
